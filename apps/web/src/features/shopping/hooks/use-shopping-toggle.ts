import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import {
	enqueueOfflineAction,
	readOfflineQueue,
	updateOfflineQueue,
} from '@/core/offline/offline-client';
import { keyUnavailableMessage } from '@/core/offline/offline-copy';
import { createQueuedShoppingUpdate, hasQueuedShoppingUpdate } from '@/core/offline/offline-queue';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import {
	shoppingActionErrorMessage,
	shoppingDuplicateMessage,
} from '@/features/shopping/shopping-errors';
import {
	type ShoppingPatchRequest,
	dropShoppingItems,
	planShoppingPatch,
	replaceShoppingItem,
	toggledShoppingItem,
	withQueuedCreateBought,
} from '@/features/shopping/shopping-toggle';
import { isTempItemId } from '@/features/shopping/shopping-view';
import { useCallback, useRef } from 'react';
import type { ShoppingActionContext } from './shopping-action-context';

const ITEM_GONE_MESSAGE =
	'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.';
const QUEUE_BLOCKED_MESSAGE =
	'Offline-Speicher ist blockiert. Der Einkaufsstatus konnte nicht vorgemerkt werden.';

/**
 * Checking an item off or reopening it. The row flips immediately; offline the change is queued
 * (or folded into a still-queued create), and a conflict restores the server state.
 */
export function useShoppingToggle(ctx: ShoppingActionContext) {
	const {
		wg,
		memberId,
		encodedShareCode,
		commit,
		pending,
		load,
		refreshCount,
		isPending,
		togglingRef,
		setToggleError,
		setToggleNotice,
	} = ctx;
	const patchKeysRef = useRef(new Map<string, { fingerprint: string; key: string }>());

	const forgetPatchKey = useCallback((itemId: string, fingerprint: string) => {
		if (patchKeysRef.current.get(itemId)?.fingerprint === fingerprint) {
			patchKeysRef.current.delete(itemId);
		}
	}, []);

	/** Folds the toggle into a create that is still waiting in the offline queue. */
	const toggleQueuedCreate = useCallback(
		async (item: ShoppingItem, bought: boolean, rollback: () => void): Promise<void> => {
			let updated = false;
			const saved = await updateOfflineQueue((actions) => {
				const next = withQueuedCreateBought(
					actions,
					{ itemId: item.id, shareCode: wg.shareCode, memberId },
					bought,
				);
				updated = next !== null;
				return next;
			});
			if (!saved) {
				rollback();
				setToggleError(QUEUE_BLOCKED_MESSAGE);
				return;
			}
			if (!updated) {
				rollback();
				void load(true);
				setToggleError(ITEM_GONE_MESSAGE);
				return;
			}
			refreshCount();
			setToggleNotice(
				bought
					? 'Offline vorgemerkt. Der neue Artikel wird direkt als erledigt synchronisiert.'
					: 'Offline vorgemerkt. Der neue Artikel wird wieder offen synchronisiert.',
			);
		},
		[load, memberId, refreshCount, setToggleError, setToggleNotice, wg.shareCode],
	);

	/** Sends the PATCH; returns after the list reflects the outcome. */
	const patchServerItem = useCallback(
		async (
			item: ShoppingItem,
			bought: boolean,
			request: ShoppingPatchRequest,
			rollback: () => void,
		): Promise<void> => {
			const res = await apiFetch<{ item: ShoppingItem }>(
				`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(item.id)}`,
				{
					method: 'PATCH',
					memberId,
					headers: { 'Idempotency-Key': request.idempotencyKey },
					body: JSON.stringify({
						bought,
						expectedUpdatedAt: request.expectedUpdatedAt,
						expectedBoughtAt: request.expectedBoughtAt,
					}),
				},
			);
			if (res.ok) {
				commit((prev) => replaceShoppingItem(prev, item.id, res.data.item));
				patchKeysRef.current.delete(item.id);
				pending.delete(item.id);
				void load(true);
				return;
			}
			// A definite rejection ends this attempt; an unknown outcome keeps the key for a retry.
			if (shouldReleaseIdempotencyKey(res.status, res.error)) {
				forgetPatchKey(item.id, request.fingerprint);
			}
			if (res.status === 403) {
				rollback();
				setToggleError('Nur wer den Artikel hinzugefügt hat, kann ihn abhaken.');
			} else if (res.status === 404 && res.error === 'item_not_found') {
				commit((prev) => dropShoppingItems(prev, (current) => current.id === item.id));
				setToggleError(ITEM_GONE_MESSAGE);
			} else if (res.status === 409 && res.error === 'shopping_item_duplicate') {
				rollback();
				await load(true);
				setToggleError(shoppingDuplicateMessage(item.name));
			} else if (res.status === 409 && res.error === 'shopping_item_changed') {
				rollback();
				await load(true);
				setToggleError('Der Einkaufsstatus hat sich geändert. Prüfe den aktualisierten Stand.');
			} else if (res.status === 0) {
				const queued = createQueuedShoppingUpdate({
					wgId: wg.id,
					shareCode: wg.shareCode,
					memberId,
					itemId: item.id,
					name: item.name,
					bought,
					expectedUpdatedAt: request.expectedUpdatedAt,
					expectedBoughtAt: request.expectedBoughtAt,
					idempotencyKey: request.idempotencyKey,
				});
				if ((await enqueueOfflineAction(queued)) === 0) {
					rollback();
					setToggleError(QUEUE_BLOCKED_MESSAGE);
					return;
				}
				patchKeysRef.current.delete(item.id);
				refreshCount();
				setToggleNotice(
					bought
						? 'Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'
						: 'Offline vorgemerkt. Der Artikel wird später wieder geöffnet.',
				);
			} else {
				rollback();
				setToggleError(
					shoppingActionErrorMessage(res.error, item.name, bought ? 'abgehakt' : 'wieder geöffnet'),
				);
			}
		},
		[
			commit,
			encodedShareCode,
			forgetPatchKey,
			load,
			memberId,
			pending,
			refreshCount,
			setToggleError,
			setToggleNotice,
			wg.id,
			wg.shareCode,
		],
	);

	return useCallback(
		async (item: ShoppingItem): Promise<void> => {
			if (isPending(item.id) || togglingRef.current.has(item.id) || isTempItemId(item.id)) return;
			const queue = readOfflineQueue();
			if (hasQueuedShoppingUpdate(queue, wg.shareCode, memberId, item.id)) {
				setToggleError(
					`„${item.name}“ hat noch eine nicht gesendete Änderung. Sie steht unter Einstellungen → Daten → Offline-Warteschlange.`,
				);
				return;
			}
			const bought = item.boughtAt === null;
			const queuedCreate = queue.some(
				(queued) =>
					queued.id === item.id &&
					queued.shareCode === wg.shareCode &&
					queued.type === 'shopping.create',
			);
			let request: ShoppingPatchRequest | null = null;
			if (!queuedCreate) {
				const plan = planShoppingPatch(
					item,
					bought,
					patchKeysRef.current.get(item.id),
					createIdempotencyKey,
				);
				if (!plan.ok) {
					if (plan.reason === 'version_missing') {
						setToggleError(
							'Der Artikelstand wird aktualisiert. Prüfe die Liste und versuche es erneut.',
						);
						void load(true);
					} else {
						setToggleError(keyUnavailableMessage('Einkaufsstatus', 'gespeichert'));
					}
					return;
				}
				request = plan.request;
				patchKeysRef.current.set(item.id, {
					fingerprint: request.fingerprint,
					key: request.idempotencyKey,
				});
			}
			togglingRef.current.add(item.id);
			setToggleError(null);
			setToggleNotice(null);
			const optimisticItem = toggledShoppingItem(item, bought, memberId, new Date());
			pending.set(optimisticItem);
			commit((prev) => replaceShoppingItem(prev, item.id, optimisticItem));
			const rollback = () => {
				pending.delete(item.id);
				commit((prev) => replaceShoppingItem(prev, item.id, item));
			};

			try {
				if (queuedCreate) {
					await toggleQueuedCreate(item, bought, rollback);
				} else if (request) {
					await patchServerItem(item, bought, request, rollback);
				}
			} finally {
				pending.delete(item.id);
				togglingRef.current.delete(item.id);
			}
		},
		[
			commit,
			isPending,
			load,
			memberId,
			patchServerItem,
			pending,
			setToggleError,
			setToggleNotice,
			toggleQueuedCreate,
			togglingRef,
			wg.shareCode,
		],
	);
}
