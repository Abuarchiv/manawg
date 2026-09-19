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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ItemGroup } from '@/components/ui/item';
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
import { createQueuedShoppingItem, createQueuedShoppingUpdate } from '@/core/offline/offline-queue';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import { ListSkeleton } from '@/features/shopping/components/ListSkeleton';
import { ShoppingItemRow } from '@/features/shopping/components/ShoppingItemRow';
import {
	NAME_MAX,
	QUANTITY_MAX,
	QUICK_SHOPPING_ITEMS,
} from '@/features/shopping/components/constants';
import type { MemberInfo, ShoppingItem } from '@/features/shopping/components/shopping-types';
import {
	clearBoughtErrorMessage,
	shoppingActionErrorMessage,
	shoppingAddErrorMessage,
} from '@/features/shopping/shopping-errors';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type ShoppingCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

type ShoppingCreateResponse = { item: ShoppingItem; warning: ShoppingCreateWarning };

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function EinkaufPage() {
	const { wg, members, identity } = useWg();
	const toast = useToast();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const searchParams = useSearchParams();
	const highlightedId = searchParams.get('highlight');
	const prefillName = searchParams.get('name');
	const [items, setItems] = useState<ShoppingItem[]>([]);
	const [initialLoading, setInitialLoading] = useState(true);
	const [newName, setNewName] = useState('');
	const [newQty, setNewQty] = useState('');
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
	const clearingBoughtRef = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const nameValueRef = useRef('');
	const quantityValueRef = useRef('');

	const draftKey = buildDraftKey(wg.shareCode, identity.memberId, 'shopping');
	const appliedPrefillRef = useRef<string | null>(null);
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
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
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
		if (draft?.name) setNewName(draft.name);
		if (draft?.quantity) setNewQty(draft.quantity);
		if (draft?.queueEditId) setQueueEditId(draft.queueEditId);
		setDraftHydrated(true);
	}, [draftKey, prefillName]);

	useEffect(() => {
		if (!prefillName) return;
		if (appliedPrefillRef.current === prefillName) return;
		appliedPrefillRef.current = prefillName;
		setNewName(prefillName.slice(0, NAME_MAX));
		setNewQty('');
		setQueueEditId(null);
	}, [prefillName]);

	useEffect(() => {
		if (!draftHydrated) return;
		writeDraft(draftKey, { name: newName, quantity: newQty, queueEditId });
	}, [draftHydrated, draftKey, newName, newQty, queueEditId]);

	useEffect(() => {
		nameValueRef.current = newName;
		quantityValueRef.current = newQty;
	}, [newName, newQty]);

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'einkauf',
		onSynced: () => void load(true),
	});

	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		window.setTimeout(() => {
			document.getElementById(`shopping-${highlightedId}`)?.scrollIntoView({
				block: 'center',
				behavior: 'smooth',
			});
		}, 80);
	}, [highlightedId, itemCount]);

	function memberLookup(id: string | null): MemberInfo {
		if (!id) return { name: '?', color: null };
		const m = members.find((x) => x.id === id);
		return { name: m?.name ?? '?', color: m?.color ?? null };
	}

	function clearEditedQueueItem(): boolean {
		if (!queueEditId) return true;
		const saved = writeOfflineQueue(readOfflineQueue().filter((item) => item.id !== queueEditId));
		if (!saved) return false;
		setQueueEditId(null);
		return true;
	}

	async function add(): Promise<void> {
		if (addingRef.current) return;
		const submittedName = newName;
		const submittedQuantity = newQty;
		const name = newName.trim();
		if (name.length === 0) return;
		addingRef.current = true;
		setAdding(true);
		setAddError(null);
		setAddNotice(null);
		try {
			const res = await apiFetch<ShoppingCreateResponse>(`/api/wg/${encodedShareCode}/shopping`, {
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				body: JSON.stringify({
					name,
					quantity: newQty.trim() || undefined,
					addedByMemberId: identity.memberId,
				}),
			});
			if (!res.ok) {
				if (res.status === 0) {
					const queued = createQueuedShoppingItem({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						name,
						quantity: newQty.trim() || null,
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
							quantity: newQty.trim() || null,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: queued.createdAt,
						},
						...prev,
					]);
					const nameUnchanged = nameValueRef.current === submittedName;
					const quantityUnchanged = quantityValueRef.current === submittedQuantity;
					if (nameUnchanged) setNewName('');
					if (quantityUnchanged) setNewQty('');
					if (nameUnchanged && quantityUnchanged) removeDraft(draftKey);
					setAddNotice('Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.');
					return;
				}
				setAddError(shoppingAddErrorMessage(res.error));
				return;
			}
			if (!clearEditedQueueItem()) {
				setAddError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			const nameUnchanged = nameValueRef.current === submittedName;
			const quantityUnchanged = quantityValueRef.current === submittedQuantity;
			if (nameUnchanged) setNewName('');
			if (quantityUnchanged) setNewQty('');
			if (nameUnchanged && quantityUnchanged) removeDraft(draftKey);
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

	async function toggleBought(item: ShoppingItem): Promise<void> {
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
		setItems((prev) => prev.map((current) => (current.id === item.id ? optimisticItem : current)));
		const rollback = () =>
			setItems((prev) => prev.map((current) => (current.id === item.id ? item : current)));

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
					setItems((prev) => prev.filter((current) => current.id !== item.id));
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
			setItems((prev) => prev.map((current) => (current.id === item.id ? res.data.item : current)));
			void load(true);
		} finally {
			end(item.id);
		}
	}

	async function remove(id: string): Promise<void> {
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
				setItems((prev) => prev.filter((item) => item.id !== id));
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
		setItems((prev) => prev.filter((item) => item.id !== id));
		void load(true);
		end(id);
	}

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
				setItems((prev) => prev.filter((item) => item.boughtAt === null));
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

	// Completion does not change row order while residents tap consecutive items.
	const orderedItems = [...items].sort(
		(a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
	);
	const actionError = toggleError ?? (removeErrorId ? null : removeError);

	function applyQuickItem(item: (typeof QUICK_SHOPPING_ITEMS)[number]): void {
		setNewName(item.name);
		setNewQty(item.quantity);
		nameInputRef.current?.focus();
	}

	return (
		<div data-household-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<header className="flex flex-col gap-1">
				<h1 className="font-heading text-2xl font-semibold tracking-tight">Einkaufsliste</h1>
				<div className="flex flex-wrap gap-2" aria-live="polite" aria-atomic="true">
					<Badge variant="secondary">{open.length} offen</Badge>
					<Badge variant="outline">{done.length} erledigt</Badge>
				</div>
			</header>
			<SubNav label="Haushalt" items={[]} />

			<div className="border-b border-border pb-4">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void add();
					}}
					className="flex flex-col gap-3"
				>
					<FieldGroup className="grid grid-cols-[minmax(0,1fr)_4.5rem_2.75rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
						<Field data-invalid={Boolean(addError)}>
							<FieldLabel htmlFor="shopping-name">Artikel</FieldLabel>
							<Input
								id="shopping-name"
								ref={nameInputRef}
								value={newName}
								onChange={(event) => {
									nameValueRef.current = event.target.value;
									setNewName(event.target.value);
								}}
								maxLength={NAME_MAX}
								placeholder="Was brauchen wir?"
								aria-label="Artikel-Name"
								enterKeyHint="done"
								aria-invalid={Boolean(addError)}
								aria-describedby={addError ? 'shopping-add-error' : undefined}
								className="min-h-11 text-base"
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="shopping-qty">
								<span className="sm:hidden">Menge</span>
								<span className="hidden sm:inline">Menge (optional)</span>
							</FieldLabel>
							<Input
								id="shopping-qty"
								value={newQty}
								onChange={(event) => {
									quantityValueRef.current = event.target.value;
									setNewQty(event.target.value);
								}}
								maxLength={QUANTITY_MAX}
								placeholder="1 L"
								aria-label="Menge (optional)"
								enterKeyHint="done"
								className="min-h-11 text-base"
							/>
						</Field>
						<Button
							type="submit"
							disabled={!newName.trim() || adding}
							aria-label="Artikel hinzufügen"
							onPointerDown={(event) => event.preventDefault()}
							className="min-h-11 px-0 sm:px-3"
						>
							{adding ? <Spinner aria-hidden /> : <Plus aria-hidden />}
							<span className="hidden sm:inline">Hinzufügen</span>
						</Button>
					</FieldGroup>
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
			</div>

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
					<EmptyContent className="flex-row flex-wrap justify-center">
						{QUICK_SHOPPING_ITEMS.map((item) => (
							<Button
								key={item.name}
								variant="ghost"
								onClick={() => applyQuickItem(item)}
								className="min-h-11"
							>
								{item.name}
							</Button>
						))}
					</EmptyContent>
				</Empty>
			) : (
				<section aria-label="Einkaufsartikel" className="flex flex-col gap-2">
					<ItemGroup className="gap-0">
						{orderedItems.map((item) => (
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
						))}
					</ItemGroup>
					{done.length > 0 && (
						<Button
							variant="outline"
							onClick={() => setClearConfirmOpen(true)}
							disabled={clearingBought}
							aria-label={`Erledigte Artikel entfernen (${done.length})`}
							className="min-h-11 self-start"
						>
							{clearingBought ? (
								<Spinner data-icon="inline-start" aria-hidden />
							) : (
								<Trash2 data-icon="inline-start" aria-hidden />
							)}
							Erledigte entfernen
						</Button>
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
