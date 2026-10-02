import { useToast } from '@/components/ui/Toast';
import { apiFetch } from '@/core/infra/api-client';
import {
	type NotificationWarning,
	notificationWarningMessage,
} from '@/core/notifications/notification-warning';
import { buildDraftKey, readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import {
	enqueueOfflineAction,
	isOfflineActionQueued,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
	QUEUE_EDIT_ALREADY_SENT_MESSAGE,
} from '@/core/offline/offline-copy';
import {
	createOfflineIdempotencyKey,
	createQueuedShoppingItem,
} from '@/core/offline/offline-queue';
import { NAME_MAX } from '@/features/shopping/components/constants';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { parseShoppingInput } from '@/features/shopping/parse-shopping-input';
import { shoppingAddErrorMessage } from '@/features/shopping/shopping-errors';
import { useEffect, useRef, useState } from 'react';

type ShoppingCreateResponse = { item: ShoppingItem; warning: NotificationWarning };

interface UseShoppingAddOptions {
	wg: { id: string; shareCode: string };
	identity: { memberId: string; memberToken?: string };
	prefillName: string | null;
	commitItems: (update: ShoppingItem[] | ((current: ShoppingItem[]) => ShoppingItem[])) => void;
	load: (silent?: boolean, afterMutation?: boolean) => Promise<void>;
	refreshCount: () => void;
	setAddNotice: (notice: string | null) => void;
}

/** Eingabefeld, Entwurf (inkl. bearbeiteter Offline-Eintrag) und Hinzufügen von Artikeln. */
export function useShoppingAdd({
	wg,
	identity,
	prefillName,
	commitItems,
	load,
	refreshCount,
	setAddNotice,
}: UseShoppingAddOptions) {
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [newName, setNewName] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const addingRef = useRef(false);
	const inFlightRef = useRef<Promise<void> | null>(null);
	const inFlightTextRef = useRef<string | null>(null);
	const addIdempotencyKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const nameValueRef = useRef('');
	const appliedPrefillRef = useRef<string | null>(null);
	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'shopping');

	useEffect(() => {
		if (prefillName) {
			setDraftHydrated(true);
			return;
		}
		const draft = readDraft<{ name?: string; quantity?: string; queueEditId?: string }>(draftKey);
		if (draft?.name) setNewName(draft.quantity ? `${draft.quantity} ${draft.name}` : draft.name);
		if (draft?.queueEditId) setQueueEditId(draft.queueEditId);
		setDraftHydrated(true);
	}, [draftKey, prefillName]);

	useEffect(() => {
		if (!prefillName) return;
		if (appliedPrefillRef.current === prefillName) return;
		appliedPrefillRef.current = prefillName;
		setNewName(prefillName.slice(0, NAME_MAX));
		setQueueEditId(null);
	}, [prefillName]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, { name: newName, queueEditId });
	}, [draftHydrated, draftKey, newName, queueEditId]);

	useEffect(() => {
		nameValueRef.current = newName;
	}, [newName]);

	async function clearEditedQueueItem(): Promise<boolean> {
		if (!queueEditId) return true;
		const saved = await updateOfflineQueue((actions) =>
			actions.some((item) => item.id === queueEditId)
				? actions.filter((item) => item.id !== queueEditId)
				: null,
		);
		if (!saved) return false;
		setQueueEditId(null);
		return true;
	}

	/** Chips übergeben ihren Text direkt; nur Eingaben aus dem Feld leeren danach das Feld. */
	async function add(text?: string): Promise<void> {
		// Chip-Doppeltipp verwerfen; eine Eingabe per Enter während eines laufenden
		// Hinzufügens wird nachgereiht statt still verworfen (gleicher Text → gleicher Key).
		if (addingRef.current && text !== undefined) return;
		const fromInput = text === undefined;
		const submittedName = text ?? newName;
		// Doppel-Enter oder Doppeltipp auf denselben Text: der läuft schon, ein zweiter Versuch
		// träfe nur die Dublettensperre und zeigte einen Fehler für einen erfolgreichen Artikel.
		if (addingRef.current && submittedName === inFlightTextRef.current) return;
		// Auch die wartende Eingabe merken: ein weiteres Enter auf denselben Text würde sonst
		// nach dem Warten ein zweites Mal gesendet und träfe die Dublettensperre.
		inFlightTextRef.current = submittedName;
		while (addingRef.current && inFlightRef.current) await inFlightRef.current;
		const { name, quantity } = parseShoppingInput(submittedName);
		if (name.length === 0) return;
		// The edited queue entry may have been synced meanwhile; a new create would duplicate it.
		if (fromInput && queueEditId && !isOfflineActionQueued(queueEditId)) {
			setQueueEditId(null);
			setNewName('');
			removeDraft(draftKey);
			setAddError(null);
			setAddNotice(QUEUE_EDIT_ALREADY_SENT_MESSAGE);
			void load(true);
			return;
		}
		addingRef.current = true;
		inFlightTextRef.current = submittedName;
		let release: () => void = () => {};
		inFlightRef.current = new Promise<void>((resolve) => {
			release = resolve;
		});
		setAdding(true);
		setAddError(null);
		setAddNotice(null);
		const fingerprint = JSON.stringify({ name, quantity });
		const pendingRequest = addIdempotencyKeyRef.current;
		const idempotencyKey =
			pendingRequest?.fingerprint === fingerprint
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			setAddError('Artikel konnte nicht sicher gespeichert werden. Versuche es erneut.');
			addingRef.current = false;
			inFlightRef.current = null;
			inFlightTextRef.current = null;
			release();
			setAdding(false);
			return;
		}
		addIdempotencyKeyRef.current = { fingerprint, key: idempotencyKey };
		try {
			const res = await apiFetch<ShoppingCreateResponse>(`/api/wg/${encodedShareCode}/shopping`, {
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					name,
					quantity: quantity ?? undefined,
					addedByMemberId: identity.memberId,
				}),
			});
			if (!res.ok) {
				const retryableResponse =
					res.status === 429 || res.status >= 500 || res.error === 'idempotency_response_pending';
				if (res.status !== 0 && !retryableResponse) addIdempotencyKeyRef.current = null;
				if (res.status === 0) {
					const queued = createQueuedShoppingItem({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						name,
						quantity,
					});
					if ((await enqueueOfflineAction(queued)) === 0) {
						setAddError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
						return;
					}
					addIdempotencyKeyRef.current = null;
					refreshCount();
					if (fromInput && !(await clearEditedQueueItem())) {
						setAddError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
						return;
					}
					commitItems((prev) => [
						{
							id: queued.id,
							addedByMemberId: identity.memberId,
							name,
							quantity,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: queued.createdAt,
						},
						...prev,
					]);
					if (fromInput && nameValueRef.current === submittedName) {
						setNewName('');
						removeDraft(draftKey);
					}
					setAddNotice('Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.');
					return;
				}
				if (res.status === 409 && res.error === 'shopping_item_duplicate') {
					await load(true);
				}
				if (retryableResponse) await load(true);
				setAddError(
					retryableResponse
						? 'Speicherstatus unklar. Prüfe die Liste und versuche es bei Bedarf erneut.'
						: shoppingAddErrorMessage(res.error),
				);
				return;
			}
			addIdempotencyKeyRef.current = null;
			if (fromInput && !(await clearEditedQueueItem())) {
				setAddError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			if (fromInput && nameValueRef.current === submittedName) {
				setNewName('');
				removeDraft(draftKey);
			}
			toast.success('Artikel hinzugefügt.');
			const warningMessage = notificationWarningMessage(res.data.warning);
			if (warningMessage) toast.info(warningMessage);
			// Show the created row right away (the POST already returned it) instead of
			// waiting for the follow-up list fetch, which then reconciles.
			const created = res.data.item;
			if (created) {
				commitItems((prev) => (prev.some((i) => i.id === created.id) ? prev : [created, ...prev]));
			}
			void load(true, true);
		} finally {
			addingRef.current = false;
			inFlightRef.current = null;
			inFlightTextRef.current = null;
			release();
			setAdding(false);
		}
	}

	function changeName(value: string): void {
		nameValueRef.current = value;
		setNewName(value);
	}

	return { newName, changeName, adding, addError, add };
}
