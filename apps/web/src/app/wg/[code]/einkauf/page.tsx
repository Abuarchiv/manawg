'use client';
import { useToast } from '@/components/ui/Toast';
import { ALERT_DANGER, EMPTY_PLACEHOLDER, LIST_CARD } from '@/components/ui/styles';
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
import posthog from '@/shared/lib/analytics';
import { ListChecks, Loader2, Package, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

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
	const [adding, setAdding] = useState(false);
	const [clearingBought, setClearingBought] = useState(false);
	const [queueEditId, setQueueEditId] = useState<string | null>(null);
	const [draftHydrated, setDraftHydrated] = useState(false);
	const { isPending, start, end } = usePendingSet();
	const addingRef = useRef(false);
	const clearingBoughtRef = useRef(false);
	const nameInputRef = useRef<HTMLInputElement>(null);

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
		const name = newName.trim();
		if (name.length === 0) return;
		addingRef.current = true;
		setAdding(true);
		setAddError(null);
		setAddNotice(null);
		try {
			const res = await apiFetch<ShoppingItem>(`/api/wg/${encodedShareCode}/shopping`, {
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
					setNewName('');
					setNewQty('');
					removeDraft(draftKey);
					setAddNotice('Offline gespeichert. Wird synchronisiert, sobald ihr wieder online seid.');
					return;
				}
				setAddError(shoppingAddErrorMessage(res.error));
				return;
			}
			posthog.capture('shopping_item_added', {
				has_quantity: newQty.trim().length > 0,
			});
			setNewName('');
			setNewQty('');
			if (!clearEditedQueueItem()) {
				setAddError(DRAFT_CLEANUP_FAILED_MESSAGE);
				return;
			}
			removeDraft(draftKey);
			toast.success('Hinzugefügt');
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
		const queuedCreate = readOfflineQueue().find(
			(queued) =>
				queued.id === item.id &&
				queued.shareCode === wg.shareCode &&
				queued.type === 'shopping.create',
		);
		if (queuedCreate) {
			const now = new Date().toISOString();
			const saved = writeOfflineQueue(
				readOfflineQueue().map((queued) =>
					queued.id === item.id
						? {
								...queued,
								payload: {
									...queued.payload,
									bought: becomingBought,
								},
							}
						: queued,
				),
			);
			if (!saved) {
				setToggleError(
					'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
				);
				end(item.id);
				return;
			}
			refreshCount();
			setItems((prev) =>
				prev.map((current) =>
					current.id === item.id
						? {
								...current,
								boughtAt: becomingBought ? now : null,
								boughtByMemberId: becomingBought ? identity.memberId : null,
							}
						: current,
				),
			);
			setToggleNotice(
				becomingBought
					? 'Offline vorgemerkt. Der neue Artikel wird direkt als erledigt synchronisiert.'
					: 'Offline vorgemerkt. Der neue Artikel wird wieder offen synchronisiert.',
			);
			end(item.id);
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
					setToggleError(
						'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
					);
					end(item.id);
					return;
				}
				refreshCount();
				const now = queued.createdAt;
				setItems((prev) =>
					prev.map((current) =>
						current.id === item.id
							? {
									...current,
									boughtAt: becomingBought ? now : null,
									boughtByMemberId: becomingBought ? identity.memberId : null,
								}
							: current,
					),
				);
				setToggleNotice(
					becomingBought
						? 'Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'
						: 'Offline vorgemerkt. Der Artikel wird später wieder geöffnet.',
				);
			} else {
				setToggleError(shoppingActionErrorMessage(res.error, 'Abhaken fehlgeschlagen.'));
			}
			end(item.id);
			return;
		}
		setItems((prev) => prev.map((current) => (current.id === item.id ? res.data.item : current)));
		if (becomingBought) posthog.capture('shopping_item_completed');
		void load(true);
		end(item.id);
	}

	async function remove(id: string): Promise<void> {
		if (isPending(id)) return;
		start(id);
		setRemoveError(null);
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
				setRemoveError('Nur der/die Autor:in kann diesen Eintrag entfernen.');
			} else if (res.status === 404 && res.error === 'item_not_found') {
				setItems((prev) => prev.filter((item) => item.id !== id));
				setRemoveError(
					'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
				);
			} else {
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

	const actionError = toggleError ?? removeError;

	function applyQuickItem(item: (typeof QUICK_SHOPPING_ITEMS)[number]): void {
		setNewName(item.name);
		setNewQty(item.quantity);
		nameInputRef.current?.focus();
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-start justify-between gap-3">
				<div>
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						Einkaufsliste
					</h1>
					<p
						className="mt-0.5 text-[13px] text-[var(--text-3)]"
						aria-live="polite"
						aria-atomic="true"
					>
						{open.length} offen{done.length > 0 ? ` · ${done.length} erledigt` : ''}
					</p>
				</div>
			</header>

			{/* Vorräte sind die andere Hälfte desselben Themas: was zur Neige geht,
			    landet hier auf der Liste. Deshalb hier verlinkt statt im Mehr-Menü. */}
			<SubNav
				label="Unterbereiche des Einkaufs"
				items={[
					{
						href: `/wg/${encodeURIComponent(wg.shareCode)}/vorraete`,
						label: 'Vorräte',
						icon: Package,
					},
				]}
			/>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					void add();
				}}
				className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3"
			>
				<div className="flex items-center gap-2">
					<input
						ref={nameInputRef}
						type="text"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						maxLength={NAME_MAX}
						placeholder="Was brauchen wir?"
						aria-label="Artikel-Name"
						disabled={adding}
						className="block h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
					/>
					<input
						type="text"
						value={newQty}
						onChange={(e) => setNewQty(e.target.value)}
						maxLength={QUANTITY_MAX}
						placeholder="Menge"
						aria-label="Menge"
						disabled={adding}
						className="block h-11 w-24 shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-2.5 text-base text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
					/>
					<button
						type="submit"
						disabled={newName.trim().length === 0 || adding}
						aria-label="Artikel hinzufügen"
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--text-1)] text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{adding ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<Plus className="h-4 w-4" aria-hidden />
						)}
					</button>
				</div>
				{addError && (
					<p
						role="alert"
						className="mt-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-2.5 py-1.5 text-[12.5px] text-[var(--danger)]"
					>
						{addError}
					</p>
				)}
				{addNotice && (
					<output
						className="mt-2 block rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-2.5 py-1.5 text-[12.5px] text-[var(--accent)]"
						aria-live="polite"
					>
						{addNotice}
					</output>
				)}
			</form>

			{queuedCount > 0 && (
				<output
					className="block rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-[13px] text-[var(--accent)]"
					aria-live="polite"
				>
					{formatQueuedOfflineEntries(queuedCount)}
				</output>
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
				<div role="alert" className={ALERT_DANGER}>
					{actionError}
				</div>
			)}

			{toggleNotice && (
				<output
					className="block rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-[13px] text-[var(--accent)]"
					aria-live="polite"
				>
					{toggleNotice}
				</output>
			)}

			{initialLoading && items.length === 0 ? (
				<ListSkeleton />
			) : loadError && items.length === 0 ? (
				<p className={EMPTY_PLACEHOLDER}>Noch keine Artikel geladen. Versuche es erneut.</p>
			) : items.length === 0 ? (
				<div className="rounded-lg border border-dashed border-[var(--border)] px-6 py-10 text-center">
					<ListChecks
						className="mx-auto mb-3 h-7 w-7 text-[var(--text-3)]"
						strokeWidth={1.5}
						aria-hidden
					/>
					<p className="mx-auto max-w-[24ch] text-[13.5px] leading-relaxed text-[var(--text-2)]">
						Noch nichts auf der Liste. Starte mit einem typischen WG-Einkauf.
					</p>
					<div className="mt-4 flex flex-wrap justify-center gap-2">
						{QUICK_SHOPPING_ITEMS.map((item) => (
							<button
								key={item.name}
								type="button"
								onClick={() => applyQuickItem(item)}
								className="inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)]"
							>
								{item.name}
							</button>
						))}
					</div>
				</div>
			) : (
				<div className="space-y-6">
					{open.length > 0 && (
						<section aria-labelledby="open-items-heading" className="space-y-2">
							<h2 id="open-items-heading" className="sr-only">
								Offene Artikel
							</h2>
							<ul className={LIST_CARD}>
								{open.map((i) => (
									<ShoppingItemRow
										key={i.id}
										item={i}
										adder={memberLookup(i.addedByMemberId)}
										buyer={null}
										isPending={isPending}
										onToggle={toggleBought}
										onRemove={remove}
										highlighted={highlightedId === i.id}
										shareCode={wg.shareCode}
									/>
								))}
							</ul>
						</section>
					)}

					{done.length > 0 && (
						<section className="space-y-2" aria-labelledby="done-heading">
							<div className="flex items-center justify-between">
								<h2
									id="done-heading"
									className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]"
								>
									Erledigt
								</h2>
								<button
									type="button"
									onClick={() => void clearBought()}
									disabled={clearingBought}
									aria-label={`Erledigte Artikel entfernen (${done.length})`}
									aria-busy={clearingBought}
									className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-[11.5px] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-40"
								>
									{clearingBought ? (
										<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
									) : (
										<Trash2 className="h-3 w-3" aria-hidden />
									)}
									Erledigte entfernen
								</button>
							</div>
							<ul className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
								{done.map((i) => (
									<ShoppingItemRow
										key={i.id}
										item={i}
										adder={memberLookup(i.addedByMemberId)}
										buyer={memberLookup(i.boughtByMemberId)}
										isPending={isPending}
										onToggle={toggleBought}
										onRemove={remove}
										highlighted={highlightedId === i.id}
										shareCode={wg.shareCode}
									/>
								))}
							</ul>
						</section>
					)}
				</div>
			)}
		</div>
	);
}
