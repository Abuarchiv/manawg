import { useCallback, useRef } from 'react';
import {
	type PendingIdempotentRequest,
	resolveIdempotencyKey,
	shouldReleaseIdempotencyKey,
} from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { readOfflineQueue } from '@/core/offline/offline-client';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { shoppingActionError, shoppingDuplicateError } from '@/features/shopping/shopping-errors';
import { dropShoppingItems, replaceShoppingItem } from '@/features/shopping/shopping-toggle';
import { isTempItemId } from '@/features/shopping/shopping-view';
import type { Message } from '@/shared/i18n/message';
import type { ShoppingActionContext } from './shopping-action-context';

/** An error message for the edit form, or null when the change was saved. */
export type ShoppingEditResult = Message | null;

export type EditShoppingItem = (
	item: ShoppingItem,
	fields: { name: string; quantity: string | null },
) => Promise<ShoppingEditResult>;

/**
 * Changing an item's name or amount. Needs a connection (the offline queue only knows check-offs);
 * the row shows the new text at once and returns to the server state when the change is refused.
 */
export function useShoppingEdit(ctx: ShoppingActionContext): EditShoppingItem {
	const { memberId, encodedShareCode, commit, pending, load, isPending, togglingRef } = ctx;
	const editKeysRef = useRef(new Map<string, PendingIdempotentRequest>());

	return useCallback(
		async (item, fields) => {
			const name = fields.name.trim();
			const quantity = fields.quantity?.trim() || null;
			if (name.length === 0) return { key: 'shopping.edit.nameEmpty' };
			if (name === item.name && quantity === item.quantity) return null;
			const queue = readOfflineQueue();
			const waitingForSync =
				isTempItemId(item.id) ||
				queue.some(
					(action) =>
						action.id === item.id ||
						(action.type === 'shopping.update' && action.payload.itemId === item.id),
				);
			if (waitingForSync || isPending(item.id) || togglingRef.current.has(item.id)) {
				return { key: 'shopping.edit.waitingForSync' };
			}
			const fingerprint = JSON.stringify({
				name,
				quantity,
				expectedUpdatedAt: item.updatedAt,
				expectedBoughtAt: item.boughtAt,
			});
			const idempotencyKey = resolveIdempotencyKey(editKeysRef.current.get(item.id), fingerprint);
			if (!item.updatedAt || !idempotencyKey) {
				void load(true);
				return { key: 'shopping.edit.versionMissing' };
			}
			editKeysRef.current.set(item.id, { fingerprint, key: idempotencyKey });

			togglingRef.current.add(item.id);
			const optimistic = { ...item, name, quantity };
			pending.set(optimistic);
			commit((prev) => replaceShoppingItem(prev, item.id, optimistic));
			const rollback = () => {
				pending.delete(item.id);
				commit((prev) => replaceShoppingItem(prev, item.id, item));
			};
			try {
				const res = await apiFetch<{ item: ShoppingItem }>(
					`/api/wg/${encodedShareCode}/shopping/${encodeURIComponent(item.id)}`,
					{
						method: 'PATCH',
						memberId,
						headers: { 'Idempotency-Key': idempotencyKey },
						body: fingerprint,
					},
				);
				if (res.ok || shouldReleaseIdempotencyKey(res.status, res.error)) {
					editKeysRef.current.delete(item.id);
				}
				if (res.ok) {
					pending.delete(item.id);
					commit((prev) => replaceShoppingItem(prev, item.id, res.data.item));
					void load(true);
					return null;
				}
				if (res.status === 404 && res.error === 'item_not_found') {
					pending.delete(item.id);
					commit((prev) => dropShoppingItems(prev, (current) => current.id === item.id));
					return { key: 'shopping.toggle.itemGone' };
				}
				rollback();
				if (res.status === 409 && res.error === 'shopping_item_duplicate') {
					return shoppingDuplicateError(name);
				}
				if (res.status === 409 && res.error === 'shopping_item_changed') {
					await load(true);
					return { key: 'shopping.edit.changed' };
				}
				if (res.status === 0) return { key: 'shopping.edit.needsConnection' };
				return shoppingActionError(res.error, item.name, 'changed');
			} finally {
				pending.delete(item.id);
				togglingRef.current.delete(item.id);
			}
		},
		[commit, encodedShareCode, isPending, load, memberId, pending, togglingRef],
	);
}
