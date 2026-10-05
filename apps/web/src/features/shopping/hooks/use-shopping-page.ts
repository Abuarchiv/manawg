import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { usePendingSet } from '@/core/hooks/usePendingSet';
import { apiFetch } from '@/core/infra/api-client';
import { captureException } from '@/core/infra/observability';
import {
	discardQueuedEntry,
	enqueueOfflineAction,
	readOfflineQueue,
	syncOfflineActions,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import {
	createOfflineIdempotencyKey,
	createQueuedShoppingUpdate,
	hasQueuedShoppingUpdate,
	isQueuedCreateId,
} from '@/core/offline/offline-queue';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { useShoppingAdd } from '@/features/shopping/hooks/use-shopping-add';
import {
	clearBoughtErrorMessage,
	shoppingActionErrorMessage,
	shoppingAddErrorMessage,
} from '@/features/shopping/shopping-errors';
import { keepItems } from '@/features/shopping/shopping-view';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseShoppingPageOptions {
	wg: { id: string; shareCode: string };
	identity: { memberId: string; memberToken?: string };
	prefillName: string | null;
	highlightedId: string | null;
	/** Nur für Vorschläge: ein Fehler beim Nachladen darf die Liste nicht blockieren. */
	refreshInventory: () => unknown;
}

/** Laden, Cache, Offline-Replay und Mutationen der Einkaufsliste. */
export function useShoppingPage({
	wg,
	identity,
	prefillName,
	highlightedId,
	refreshInventory,
}: UseShoppingPageOptions) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const {
		data: cachedShopping,
		error: shoppingReadError,
		isLoading: shoppingReadLoading,
		refresh: refreshShopping,
		setData: setCachedShopping,
	} = useCachedFetch<{ items: ShoppingItem[] }>(`/api/wg/${encodedShareCode}/shopping`, {
		memberId: identity.memberId,
	});
	const [items, setItems] = useState<ShoppingItem[]>(() => cachedShopping?.items ?? []);
	const commitItems = useCallback(
		(update: ShoppingItem[] | ((current: ShoppingItem[]) => ShoppingItem[])) => {
			setItems(update);
			setCachedShopping((current) => {
				const previousItems = current?.items ?? items;
				const nextItems = typeof update === 'function' ? update(previousItems) : update;
				if (!current && nextItems === previousItems) return current;
				return { ...(current ?? { items: previousItems }), items: nextItems };
			});
		},
		[items, setCachedShopping],
	);
	const [initialLoading, setInitialLoading] = useState(shoppingReadLoading);
	const [doneOpen, setDoneOpen] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [addNotice, setAddNotice] = useState<string | null>(null);
	const [toggleError, setToggleError] = useState<string | null>(null);
	const [toggleNotice, setToggleNotice] = useState<string | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	const [removeErrorId, setRemoveErrorId] = useState<string | null>(null);
	const [clearingBought, setClearingBought] = useState(false);
	const { isPending, start, end } = usePendingSet();
	const clearingBoughtRef = useRef(false);
	const shoppingPatchRequestKeysRef = useRef(
		new Map<string, { fingerprint: string; key: string }>(),
	);
	const mountedRef = useRef(false);
	const loadRequestIdRef = useRef(0);
	const hasShoppingCacheRef = useRef(cachedShopping !== undefined);

	const load = useCallback(
		async (silent = false, afterMutation = false): Promise<void> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (!silent && !hasShoppingCacheRef.current) setInitialLoading(true);
			const res = await refreshShopping({ afterMutation });
			if (requestId !== loadRequestIdRef.current) {
				if (!silent) setInitialLoading(false);
				return;
			}
			if (res.ok) {
				setLoadError(null);
				setItems(res.data.items);
				// Nur für Vorschläge: ein Fehler hier darf die Liste nicht blockieren.
				void refreshInventory();
				syncOfflineActions(wg.shareCode, { memberId: identity.memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshCount();
						if (synced > 0) {
							// Die „Offline vorgemerkt“-Hinweise sind mit dem Replay überholt.
							setAddNotice(null);
							setToggleNotice(null);
							void load(true);
						}
					})
					.catch((err) => captureException(err, { action: 'syncOfflineActions', page: 'einkauf' }));
			} else {
				// keep existing items on error during silent refresh
				if (!silent) setLoadError(getWgLoadErrorMessage('Einkaufsliste', res.status, res.error));
			}
			if (!silent && requestId === loadRequestIdRef.current) setInitialLoading(false);
		},
		[identity.memberId, refreshInventory, refreshShopping, wg.shareCode],
	);
	useEffect(() => {
		if (cachedShopping) {
			hasShoppingCacheRef.current = true;
			setItems(cachedShopping.items);
			setLoadError(null);
			setInitialLoading(false);
		} else if (shoppingReadError) {
			setLoadError(
				getWgLoadErrorMessage('Einkaufsliste', shoppingReadError.status, shoppingReadError.error),
			);
			setInitialLoading(false);
		}
	}, [cachedShopping, shoppingReadError]);
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

	const { queuedCount, refreshCount } = useOfflineQueueSync({
		shareCode: wg.shareCode,
		memberId: identity.memberId,
		page: 'einkauf',
		onSynced: () => void load(true),
	});

	const add = useShoppingAdd({
		wg,
		identity,
		prefillName,
		commitItems,
		load,
		refreshCount,
		setAddNotice,
	});

	// Nur einmal pro Deep-Link springen, nicht bei jedem Poll/Refresh erneut.
	const scrolledHighlightRef = useRef<string | null>(null);
	useEffect(() => {
		if (!highlightedId || itemCount === 0) return;
		if (scrolledHighlightRef.current === highlightedId) return;
		scrolledHighlightRef.current = highlightedId;
		if (items.some((item) => item.id === highlightedId && item.boughtAt !== null))
			setDoneOpen(true);
		window.setTimeout(() => {
			document.getElementById(`shopping-${highlightedId}`)?.scrollIntoView({
				block: 'center',
			});
		}, 80);
	}, [highlightedId, itemCount, items]);
	const toggleBought = useCallback(
		async (item: ShoppingItem): Promise<void> => {
			if (isPending(item.id)) return;
			if (hasQueuedShoppingUpdate(readOfflineQueue(), wg.shareCode, identity.memberId, item.id)) {
				return;
			}
			const becomingBought = item.boughtAt === null;
			const queuedCreate = readOfflineQueue().find(
				(queued) =>
					queued.id === item.id &&
					queued.shareCode === wg.shareCode &&
					queued.type === 'shopping.create',
			);
			let patchRequest: {
				expectedUpdatedAt: string;
				expectedBoughtAt: string | null;
				fingerprint: string;
				idempotencyKey: string;
			} | null = null;
			if (!queuedCreate) {
				if (!item.updatedAt) {
					setToggleError(
						'Der Artikelstand wird aktualisiert. Prüfe die Liste und versuche es erneut.',
					);
					void load(true);
					return;
				}
				const fingerprint = JSON.stringify({
					expectedUpdatedAt: item.updatedAt,
					expectedBoughtAt: item.boughtAt,
					bought: becomingBought,
				});
				const previous = shoppingPatchRequestKeysRef.current.get(item.id);
				const idempotencyKey =
					previous?.fingerprint === fingerprint ? previous.key : createOfflineIdempotencyKey();
				if (!idempotencyKey) {
					setToggleError(
						'Einkaufsstatus konnte nicht sicher gespeichert werden. Versuche es erneut.',
					);
					return;
				}
				patchRequest = {
					expectedUpdatedAt: item.updatedAt,
					expectedBoughtAt: item.boughtAt,
					fingerprint,
					idempotencyKey,
				};
				shoppingPatchRequestKeysRef.current.set(item.id, { fingerprint, key: idempotencyKey });
			}
			start(item.id);
			setToggleError(null);
			setToggleNotice(null);
			const optimisticItem: ShoppingItem = {
				...item,
				boughtAt: becomingBought ? new Date().toISOString() : null,
				boughtByMemberId: becomingBought ? identity.memberId : null,
			};
			commitItems((prev) =>
				keepItems(
					prev,
					prev.map((current) => (current.id === item.id ? optimisticItem : current)),
				),
			);
			const rollback = () =>
				commitItems((prev) =>
					keepItems(
						prev,
						prev.map((current) => (current.id === item.id ? item : current)),
					),
				);

			try {
				if (queuedCreate) {
					let updated = false;
					const saved = await updateOfflineQueue((actions) => {
						const queued = actions.find(
							(action) =>
								action.id === item.id &&
								action.shareCode === wg.shareCode &&
								action.memberId === identity.memberId &&
								action.type === 'shopping.create',
						);
						if (!queued) return null;
						updated = true;
						return actions.map((action) =>
							action.id === item.id &&
							action.shareCode === wg.shareCode &&
							action.memberId === identity.memberId &&
							action.type === 'shopping.create'
								? { ...action, payload: { ...action.payload, bought: becomingBought } }
								: action,
						);
					});
					if (!saved) {
						rollback();
						setToggleError(
							'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
						);
						return;
					}
					if (!updated) {
						rollback();
						void load(true);
						setToggleError(
							'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
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
				if (!patchRequest) {
					rollback();
					setToggleError('Der Einkaufsstatus konnte nicht sicher gespeichert werden.');
					return;
				}

				const res = await apiFetch<{ item: ShoppingItem }>(
					`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(item.id)}`,
					{
						method: 'PATCH',
						memberId: identity.memberId,
						memberToken: identity.memberToken,
						headers: { 'Idempotency-Key': patchRequest.idempotencyKey },
						body: JSON.stringify({
							bought: becomingBought,
							expectedUpdatedAt: patchRequest.expectedUpdatedAt,
							expectedBoughtAt: patchRequest.expectedBoughtAt,
						}),
					},
				);
				if (!res.ok) {
					if (res.status > 0 && res.status < 500 && res.status !== 429) {
						const pending = shoppingPatchRequestKeysRef.current.get(item.id);
						if (pending?.fingerprint === patchRequest.fingerprint) {
							shoppingPatchRequestKeysRef.current.delete(item.id);
						}
					}
					if (res.status === 403) {
						rollback();
						setToggleError('Nur wer den Artikel hinzugefügt hat, kann ihn abhaken.');
					} else if (res.status === 404 && res.error === 'item_not_found') {
						commitItems((prev) =>
							keepItems(
								prev,
								prev.filter((current) => current.id !== item.id),
							),
						);
						setToggleError(
							'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
						);
					} else if (res.status === 409 && res.error === 'shopping_item_duplicate') {
						rollback();
						await load(true);
						setToggleError(shoppingAddErrorMessage(res.error));
					} else if (res.status === 409 && res.error === 'shopping_item_changed') {
						rollback();
						await load(true);
						setToggleError('Der Einkaufsstatus hat sich geändert. Prüfe den aktualisierten Stand.');
					} else if (res.status === 0) {
						const queued = createQueuedShoppingUpdate({
							wgId: wg.id,
							shareCode: wg.shareCode,
							memberId: identity.memberId,
							itemId: item.id,
							name: item.name,
							bought: becomingBought,
							expectedUpdatedAt: patchRequest.expectedUpdatedAt,
							expectedBoughtAt: patchRequest.expectedBoughtAt,
							idempotencyKey: patchRequest.idempotencyKey,
						});
						if ((await enqueueOfflineAction(queued)) === 0) {
							rollback();
							setToggleError(
								'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.',
							);
							return;
						}
						shoppingPatchRequestKeysRef.current.delete(item.id);
						refreshCount();
						setToggleNotice(
							becomingBought
								? 'Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'
								: 'Offline vorgemerkt. Der Artikel wird später wieder geöffnet.',
						);
					} else {
						rollback();
						setToggleError(
							shoppingActionErrorMessage(
								res.error,
								'Abhaken fehlgeschlagen. Versuche es gleich erneut.',
							),
						);
					}
					return;
				}
				commitItems((prev) =>
					keepItems(
						prev,
						prev.map((current) => (current.id === item.id ? res.data.item : current)),
					),
				);
				shoppingPatchRequestKeysRef.current.delete(item.id);
				void load(true);
			} finally {
				end(item.id);
			}
		},
		[
			end,
			encodedShareCode,
			commitItems,
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
			try {
				setToggleError(null);
				setRemoveError(null);
				setRemoveErrorId(null);
				const queued = await discardQueuedEntry(wg.shareCode, id);
				if (queued === 'storage_blocked') {
					setRemoveErrorId(id);
					setRemoveError(
						'Offline-Speicher ist blockiert. Der vorgemerkte Artikel konnte nicht entfernt werden.',
					);
					return;
				}
				if (queued === 'removed' || isQueuedCreateId(id)) {
					commitItems((prev) =>
						keepItems(
							prev,
							prev.filter((item) => item.id !== id),
						),
					);
					refreshCount();
					setToggleNotice('Offline vorgemerkter Artikel wurde entfernt.');
					return;
				}
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
						setRemoveError(
							'Nur wer den Artikel hinzugefügt hat oder ein WG-Admin kann ihn entfernen.',
						);
					} else if (res.status === 404 && res.error === 'item_not_found') {
						commitItems((prev) =>
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
						setRemoveError(
							shoppingActionErrorMessage(
								res.error,
								'Entfernen fehlgeschlagen. Versuche es gleich erneut.',
							),
						);
					}
					return;
				}
				commitItems((prev) =>
					keepItems(
						prev,
						prev.filter((item) => item.id !== id),
					),
				);
				void load(true);
			} finally {
				end(id);
			}
		},
		[
			end,
			encodedShareCode,
			commitItems,
			identity.memberId,
			identity.memberToken,
			isPending,
			load,
			refreshCount,
			start,
			wg.shareCode,
		],
	);

	async function clearBought(): Promise<void> {
		if (clearingBoughtRef.current) return;
		clearingBoughtRef.current = true;
		setClearingBought(true);
		setToggleError(null);
		setRemoveError(null);
		setRemoveErrorId(null);
		try {
			const res = await apiFetch<{ deleted: number }>(`/api/wg/${encodedShareCode}/shopping`, {
				method: 'DELETE',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
			});
			if (res.ok) {
				commitItems((prev) =>
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

	return {
		items,
		initialLoading,
		loadError,
		load,
		queuedCount,
		doneOpen,
		setDoneOpen,
		addNotice,
		toggleError,
		toggleNotice,
		removeError,
		removeErrorId,
		clearingBought,
		isPending,
		toggleBought,
		remove,
		clearBought,
		add,
	};
}
