'use client';
import { useToast } from '@/components/ui/Toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { SubNav } from '@/components/wg/SubNav';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { usePendingSet } from '@/core/hooks/usePendingSet';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/observability';
import { buildDraftKey, readDraft, removeDraft, writeDraft } from '@/core/offline/drafts';
import {
	enqueueOfflineAction,
	readOfflineQueue,
	syncOfflineActions,
	writeOfflineQueue,
} from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
	formatQueuedOfflineEntries,
} from '@/core/offline/offline-copy';
import {
	createOfflineIdempotencyKey,
	createQueuedShoppingItem,
	createQueuedShoppingUpdate,
} from '@/core/offline/offline-queue';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import {
	type InventoryItemDto,
	isBelowThreshold,
	normalizeForMatch,
} from '@/features/inventory/inventory';
import { ListSkeleton } from '@/features/shopping/components/ListSkeleton';
import { ShoppingItemRow } from '@/features/shopping/components/ShoppingItemRow';
import { NAME_MAX, QUICK_SHOPPING_ITEMS } from '@/features/shopping/components/constants';
import type { MemberInfo, ShoppingItem } from '@/features/shopping/components/shopping-types';
import { parseShoppingInput } from '@/features/shopping/parse-shopping-input';
import {
	clearBoughtErrorMessage,
	shoppingActionErrorMessage,
	shoppingAddErrorMessage,
} from '@/features/shopping/shopping-errors';
import { cn } from '@/shared/lib/cn';
import { ChevronRight, ListChecks, Plus, Receipt, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ShoppingCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

type ShoppingCreateResponse = { item: ShoppingItem; warning: ShoppingCreateWarning };

const UNKNOWN_MEMBER: MemberInfo = { name: '?', color: null };
const RECEIPT_PROMPT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Keeps the same array reference when nothing actually changed, so memoized
// rows do not re-render on unrelated state updates (typing, error banners).
function keepItems(prev: ShoppingItem[], next: ShoppingItem[]): ShoppingItem[] {
	const unchanged =
		prev.length === next.length && prev.every((item, index) => item === next[index]);
	return unchanged ? prev : next;
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function EinkaufPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillName = searchParams.get('name');
	const [items, setItems] = useState<ShoppingItem[]>([]);
	const [initialLoading, setInitialLoading] = useState(true);
	const [newName, setNewName] = useState('');
	const [inventory, setInventory] = useState<InventoryItemDto[]>([]);
	const [doneOpen, setDoneOpen] = useState(false);
	const [receiptSince, setReceiptSince] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [addError, setAddError] = useState<string | null>(null);
	const [addNotice, setAddNotice] = useState<string | null>(null);
	const [toggleError, setToggleError] = useState<string | null>(null);
	const [toggleNotice, setToggleNotice] = useState<string | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [removeErrorId, setRemoveErrorId] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const [clearingBought, setClearingBought] = useState(false);
	const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const { isPending, start, end } = usePendingSet();
	const addingRef = useRef(false);
	const addIdempotencyKeyRef = useRef<{ fingerprint: string; key: string } | null>(null);
	const clearingBoughtRef = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const nameValueRef = useRef('');

	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'shopping');
	const appliedPrefillRef = useRef<string | null>(null);
	const mountedRef = useRef(false);
	const loadRequestIdRef = useRef(0);

	const load = useCallback(
		async (silent = false): Promise<void> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (!silent) setInitialLoading(true);
			const res = await apiFetch<{ items: ShoppingItem[] }>(
				`/api/wg/${encodedShareCode}/shopping`,
				{
					memberId: identity.memberId,
				},
			);
			if (requestId !== loadRequestIdRef.current) {
				if (!silent) setInitialLoading(false);
				return;
			}
			if (res.ok) {
				setLoadError(null);
				setItems(res.data.items);
				// Nur für Vorschläge: ein Fehler hier darf die Liste nicht blockieren.
				void apiFetch<{ items: InventoryItemDto[] }>(`/api/wg/${encodedShareCode}/inventory`, {
					memberId: identity.memberId,
				}).then((inventoryRes) => {
					if (inventoryRes.ok && mountedRef.current) setInventory(inventoryRes.data.items);
				});
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshCount();
						if (synced > 0) void load(true);
					})
					.catch((err) => captureException(err, { action: 'syncOfflineActions', page: 'einkauf' }));
			} else {
				// keep existing items on error during silent refresh
				if (!silent) setLoadError(getWgLoadErrorMessage('Einkaufsliste', res.status, res.error));
			}
			if (!silent && requestId === loadRequestIdRef.current) setInitialLoading(false);
		},
		[encodedShareCode, identity.memberId, wg.shareCode],
	);
	const itemCount = items.length;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		void load(false);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
	useVisibilityPausedInterval(() => void load(true), 30_000);

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

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'einkauf',
		onSynced: () => void load(true),
	});

	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		if (items.some((item) => item.id === highlightedId && item.boughtAt !== null))
			setDoneOpen(true);
		window.setTimeout(() => {
			document.getElementById(`shopping-${highlightedId}`)?.scrollIntoView({
				block: 'center',
				behavior: 'smooth',
			});
		}, 80);
	}, [highlightedId, itemCount, items]);

	const memberInfoById = useMemo(() => {
		const map = new Map<string, MemberInfo>();
		for (const member of members) {
			map.set(member.id, { name: member.name, color: member.color ?? null });
		}
		return map;
	}, [members]);

	const memberLookup = useCallback(
		(id: string | null): MemberInfo => {
			if (!id) return UNKNOWN_MEMBER;
			return memberInfoById.get(id) ?? UNKNOWN_MEMBER;
		},
		[memberInfoById],
	);

	function clearEditedQueueItem(): boolean {
		if (!queueEditId) return true;
		const saved = writeOfflineQueue(readOfflineQueue().filter((item) => item.id !== queueEditId));
		if (!saved) return false;
		setQueueEditId(null);
		return true;
	}

	/** Chips übergeben ihren Text direkt; nur Eingaben aus dem Feld leeren danach das Feld. */
	async function add(text?: string): Promise<void> {
		if (addingRef.current) return;
		const fromInput = text === undefined;
		const submittedName = text ?? newName;
		const { name, quantity } = parseShoppingInput(submittedName);
		if (name.length === 0) return;
		addingRef.current = true;
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
				if (res.status !== 0) addIdempotencyKeyRef.current = null;
				if (res.status === 0) {
					const queued = createQueuedShoppingItem({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						name,
						quantity,
					});
					if (enqueueOfflineAction(queued) === 0) {
						setAddError(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
						return;
					}
					refreshCount();
					if (!clearEditedQueueItem()) {
						setAddError(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
						return;
					}
					setItems((prev) => [
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
				setAddError(shoppingAddErrorMessage(res.error));
				return;
			}
			addIdempotencyKeyRef.current = null;
			if (!clearEditedQueueItem()) {
				setAddError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			if (fromInput && nameValueRef.current === submittedName) {
				setNewName('');
				removeDraft(draftKey);
			}
			toast.success('Hinzugefügt');
			if (res.data.warning === 'notification_delivery_failed') {
				toast.info('Gespeichert. Nicht alle Push-Benachrichtigungen konnten versendet werden.');
			} else if (res.data.warning === 'notification_delivery_unknown') {
				toast.info('Gespeichert. Push-Versand konnte nicht bestätigt werden.');
			}
			void load(true);
		} finally {
			addingRef.current = false;
			setAdding(false);
		}
	}

	const toggleBought = useCallback(
		async (item: ShoppingItem): Promise<void> => {
			if (isPending(item.id)) return;
			start(item.id);
			setToggleError(null);
			setToggleNotice(null);
			const becomingBought = item.boughtAt === null;
			const optimisticItem: ShoppingItem = {
				...item,
				boughtAt: becomingBought ? new Date().toISOString() : null,
				boughtByMemberId: becomingBought ? identity.memberId : null,
			};
			setItems((prev) =>
				keepItems(
					prev,
					prev.map((current) => (current.id === item.id ? optimisticItem : current)),
				),
			);
			const rollback = () =>
				setItems((prev) =>
					keepItems(
						prev,
						prev.map((current) => (current.id === item.id ? item : current)),
					),
				);

			try {
				const queuedCreate = readOfflineQueue().find(
					(queued) =>
						queued.id === item.id &&
						queued.shareCode === wg.shareCode &&
						queued.type === 'shopping.create',
				);
				if (queuedCreate) {
					const saved = writeOfflineQueue(
						readOfflineQueue().map((queued) =>
							queued.id === item.id
								? { ...queued, payload: { ...queued.payload, bought: becomingBought } }
								: queued,
						),
					);
					if (!saved) {
						rollback();
						setToggleError(
							'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
						);
						return;
					}
					refreshCount();
					setToggleNotice(
						becomingBought
							? 'Offline vorgemerkt. Der neue Artikel wird direkt als erledigt synchronisiert.'
							: 'Offline vorgemerkt. Der neue Artikel wird wieder offen synchronisiert.',
					);
					return;
				}

				const res = await apiFetch<{ item: ShoppingItem }>(
					`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(item.id)}`,
					{
						method: 'PATCH',
						memberId: identity.memberId,
						memberToken: identity.memberToken,
						body: JSON.stringify({
							bought: becomingBought,
							boughtByMemberId: becomingBought ? identity.memberId : null,
						}),
					},
				);
				if (!res.ok) {
					if (res.status === 403) {
						rollback();
						setToggleError('Nur der/die Autor:in kann dies abhaken.');
					} else if (res.status === 404 && res.error === 'item_not_found') {
						setItems((prev) =>
							keepItems(
								prev,
								prev.filter((current) => current.id !== item.id),
							),
						);
						setToggleError(
							'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
						);
					} else if (res.status === 0) {
						const queued = createQueuedShoppingUpdate({
							wgId: wg.id,
							shareCode: wg.shareCode,
							memberId: identity.memberId,
							itemId: item.id,
							name: item.name,
							bought: becomingBought,
						});
						if (enqueueOfflineAction(queued) === 0) {
							rollback();
							setToggleError(
								'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
							);
							return;
						}
						refreshCount();
						setToggleNotice(
							becomingBought
								? 'Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'
								: 'Offline vorgemerkt. Der Artikel wird später wieder geöffnet.',
						);
					} else {
						rollback();
						setToggleError(shoppingActionErrorMessage(res.error, 'Abhaken fehlgeschlagen.'));
					}
					return;
				}
				setItems((prev) =>
					keepItems(
						prev,
						prev.map((current) => (current.id === item.id ? res.data.item : current)),
					),
				);
				void load(true);
			} finally {
				end(item.id);
			}
		},
		[
			end,
			encodedShareCode,
			identity.memberId,
			identity.memberToken,
			isPending,
			load,
			refreshCount,
			start,
			wg.id,
			wg.shareCode,
		],
	);

	const remove = useCallback(
		async (id: string): Promise<void> => {
			if (isPending(id)) return;
			start(id);
			setRemoveError(null);
			setRemoveErrorId(null);
			const res = await apiFetch<unknown>(
				`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(id)}`,
				{
					method: 'DELETE',
					memberId: identity.memberId,
					memberToken: identity.memberToken,
				},
			);
			if (!res.ok) {
				if (res.status === 403) {
					setRemoveErrorId(id);
					setRemoveError('Nur der/die Autor:in kann diesen Eintrag entfernen.');
				} else if (res.status === 404 && res.error === 'item_not_found') {
					setItems((prev) =>
						keepItems(
							prev,
							prev.filter((item) => item.id !== id),
						),
					);
					setRemoveError(
						'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
					);
				} else {
					setRemoveErrorId(id);
					setRemoveError(shoppingActionErrorMessage(res.error, 'Entfernen fehlgeschlagen.'));
				}
				end(id);
				return;
			}
			setItems((prev) =>
				keepItems(
					prev,
					prev.filter((item) => item.id !== id),
				),
			);
			void load(true);
			end(id);
		},
		[end, encodedShareCode, identity.memberId, identity.memberToken, isPending, load, start],
	);

	async function clearBought(): Promise<void> {
		if (clearingBoughtRef.current) return;
		clearingBoughtRef.current = true;
		setClearingBought(true);
		setRemoveError(null);
		setRemoveErrorId(null);
		try {
			const res = await apiFetch<{ deleted: number }>(`/api/wg/${encodedShareCode}/shopping`, {
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			});
			if (res.ok) {
				setItems((prev) =>
					keepItems(
						prev,
						prev.filter((item) => item.boughtAt === null),
					),
				);
				void load(true);
			} else {
				setRemoveError(clearBoughtErrorMessage(res.status, res.error));
			}
		} finally {
			clearingBoughtRef.current = false;
			setClearingBought(false);
		}
	}

	const open = items.filter((i) => i.boughtAt === null);
	const done = items.filter((i) => i.boughtAt !== null);

	const byCreated = (a: ShoppingItem, b: ShoppingItem) =>
		a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
	const openItems = [...open].sort(byCreated);
	const doneItems = [...done].sort(
		(a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? '') || byCreated(a, b),
	);
	const actionError = toggleError ?? (removeErrorId ? null : removeError);

	// Nach dem Einkauf: eigene frisch gekaufte Artikel direkt als Ausgabe erfassen.
	const receiptKey = `manawg:receipt-prompt:${wg.shareCode}`;
	useEffect(() => {
		try {
			setReceiptSince(window.localStorage.getItem(receiptKey));
		} catch {
			// Ohne Speicher erscheint der Hinweis nur für die letzten Stunden.
		}
	}, [receiptKey]);
	const receiptCutoff = Math.max(
		Date.now() - RECEIPT_PROMPT_WINDOW_MS,
		receiptSince ? Date.parse(receiptSince) || 0 : 0,
	);
	const myFreshBought = doneItems.filter(
		(item) =>
			item.boughtByMemberId === identity.memberId &&
			item.boughtAt !== null &&
			Date.parse(item.boughtAt) > receiptCutoff,
	);
	function dismissReceiptPrompt(): void {
		const now = new Date().toISOString();
		setReceiptSince(now);
		try {
			window.localStorage.setItem(receiptKey, now);
		} catch {
			// Hinweis bleibt dann nur in dieser Sitzung ausgeblendet.
		}
	}

	// Vorschläge ohne Artikel, die schon offen auf der Liste stehen.
	const openNames = new Set(open.map((item) => normalizeForMatch(item.name)));
	const lowStock = inventory
		.filter((item) => isBelowThreshold(item) && !openNames.has(normalizeForMatch(item.name)))
		.map((item) => item.name);
	const taken = new Set([...openNames, ...lowStock.map(normalizeForMatch)]);
	const frequent = [
		...inventory
			.filter((item) => item.decrementCount30d > 0)
			.sort((a, b) => b.decrementCount30d - a.decrementCount30d)
			.map((item) => item.name),
		...done.map((item) => item.name),
	].filter((name) => {
		const key = normalizeForMatch(name);
		if (taken.has(key)) return false;
		taken.add(key);
		return true;
	});
	const suggestionGroups = [
		{ label: 'Vorrat niedrig', names: lowStock.slice(0, 6) },
		frequent.length > 0
			? { label: 'Oft gekauft', names: frequent.slice(0, 6) }
			: {
					label: 'Vorschläge',
					names: QUICK_SHOPPING_ITEMS.map((item) => item.name).filter(
						(name) => !taken.has(normalizeForMatch(name)),
					),
				},
	].filter((group) => group.names.length > 0);

	function renderRow(item: ShoppingItem) {
		return (
			<ShoppingItemRow
				key={item.id}
				item={item}
				adder={memberLookup(item.addedByMemberId)}
				buyer={item.boughtByMemberId ? memberLookup(item.boughtByMemberId) : null}
				isPending={isPending}
				onToggle={toggleBought}
				onRemove={remove}
				removeError={removeErrorId === item.id ? removeError : null}
				canRemove={item.addedByMemberId === identity.memberId}
				highlighted={highlightedId === item.id}
				shareCode={wg.shareCode}
			/>
		);
	}

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<SubNav />
			<header>
				<h1 className="font-heading text-[26px] leading-8 font-semibold tracking-tight text-foreground">
					Einkaufsliste
				</h1>
				<p
					className="mt-0.5 text-[13px] text-muted-foreground tabular-nums"
					aria-live="polite"
					aria-atomic="true"
				>
					{open.length} offen
				</p>
			</header>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					void add();
				}}
				className="flex flex-col gap-3"
			>
				<div className="flex flex-wrap gap-2">
					<Input
						id="shopping-name"
						ref={nameInputRef}
						value={newName}
						onChange={(event) => {
							nameValueRef.current = event.target.value;
							setNewName(event.target.value);
						}}
						maxLength={NAME_MAX}
						placeholder="z. B. 2 Hafermilch"
						aria-label="Artikel-Name"
						enterKeyHint="done"
						aria-invalid={Boolean(addError)}
						aria-describedby={addError ? 'shopping-add-error' : undefined}
						className="flex-1 basis-48 text-base"
					/>
					<Button
						type="submit"
						size="icon"
						disabled={!newName.trim() || adding}
						aria-label="Artikel hinzufügen"
						onPointerDown={(event) => event.preventDefault()}
						className="size-11 shrink-0"
					>
						{adding ? <Spinner aria-hidden /> : <Plus aria-hidden />}
					</Button>
				</div>
				{suggestionGroups.map((group) => (
					<div key={group.label} className="flex min-w-0 flex-col gap-1.5">
						<p className="text-sm font-medium text-muted-foreground">{group.label}</p>
						<ul
							aria-label={group.label}
							className="-mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]"
						>
							{group.names.map((name) => (
								<li key={name} className="shrink-0">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={adding}
										onClick={() => void add(name)}
										aria-label={`${name} hinzufügen`}
										className="max-w-56"
									>
										<Plus data-icon="inline-start" aria-hidden />
										<span className="truncate">{name}</span>
									</Button>
								</li>
							))}
						</ul>
					</div>
				))}
				{addError && (
					<Alert id="shopping-add-error" variant="destructive">
						<AlertDescription>{addError}</AlertDescription>
					</Alert>
				)}
				{addNotice && (
					<Alert>
						<AlertDescription>{addNotice}</AlertDescription>
					</Alert>
				)}
			</form>

			{queuedCount > 0 && (
				<Alert>
					<AlertDescription>{formatQueuedOfflineEntries(queuedCount)}</AlertDescription>
				</Alert>
			)}
			{loadError && (
				<LoadErrorBanner
					message={loadError}
					onRetry={() => void load(false)}
					busy={initialLoading}
					retryLabel="Liste erneut laden"
				/>
			)}
			{actionError && (
				<Alert variant="destructive">
					<AlertDescription>{actionError}</AlertDescription>
				</Alert>
			)}
			{toggleNotice && (
				<Alert>
					<AlertDescription>{toggleNotice}</AlertDescription>
				</Alert>
			)}
			{myFreshBought.length > 0 && (
				<Alert>
					<Receipt aria-hidden />
					<AlertDescription className="flex flex-col gap-2">
						<span>Beleg für {myFreshBought.length} Artikel als Ausgabe erfassen?</span>
						<span className="flex flex-wrap gap-2">
							<Link
								href={`${wgBaseHref}/ausgaben?new=1&desc=${encodeURIComponent(
									`Einkauf: ${myFreshBought
										.slice(0, 5)
										.map((item) => item.name)
										.join(', ')}`,
								)}`}
								onClick={dismissReceiptPrompt}
								className={cn(buttonVariants({ size: 'sm' }), '')}
							>
								Ausgabe erfassen
							</Link>
							<Button variant="ghost" size="sm" onClick={dismissReceiptPrompt}>
								Nicht jetzt
							</Button>
						</span>
					</AlertDescription>
				</Alert>
			)}

			{initialLoading && items.length === 0 ? (
				<ListSkeleton />
			) : loadError && items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Noch keine Artikel geladen</EmptyTitle>
						<EmptyDescription>Versuche es erneut.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : items.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<ListChecks aria-hidden />
						</EmptyMedia>
						<EmptyTitle>Noch nichts auf der Liste</EmptyTitle>
						<EmptyDescription>Was fehlt bei euch?</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<section aria-label="Einkaufsartikel" className="flex flex-col gap-4">
					{openItems.length > 0 ? (
						<ul className="flex flex-col">{openItems.map(renderRow)}</ul>
					) : (
						<p className="text-sm text-muted-foreground">Alles eingekauft.</p>
					)}
					{doneItems.length > 0 && (
						<details
							open={doneOpen}
							onToggle={(event) => setDoneOpen(event.currentTarget.open)}
							className="group"
						>
							<summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
								<ChevronRight
									aria-hidden
									className="size-4 transition-transform group-open:rotate-90"
								/>
								Erledigt ({doneItems.length})
							</summary>
							<ul className="flex flex-col">{doneItems.map(renderRow)}</ul>
							<Button
								variant="outline"
								onClick={() => setClearConfirmOpen(true)}
								disabled={clearingBought}
								aria-label={`Erledigte Artikel entfernen (${done.length})`}
								className="mt-2 self-start"
							>
								{clearingBought ? (
									<Spinner data-icon="inline-start" aria-hidden />
								) : (
									<Trash2 data-icon="inline-start" aria-hidden />
								)}
								Erledigte entfernen
							</Button>
						</details>
					)}
				</section>
			)}
			<AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
				<AlertDialogContent className="max-w-[calc(100%-2rem)]">
					<AlertDialogHeader>
						<AlertDialogTitle>Erledigte Artikel entfernen?</AlertDialogTitle>
						<AlertDialogDescription>
							{done.length} erledigte Artikel werden für die ganze WG endgültig entfernt. Offene
							Artikel bleiben erhalten.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Abbrechen</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11 min-w-0 max-w-full shrink whitespace-normal"
							disabled={clearingBought}
							onClick={() => {
								setClearConfirmOpen(false);
								void clearBought();
							}}
						>
							Entfernen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
