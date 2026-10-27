import { mutationErrorMessage } from '@/core/http/error-codes';
import { createIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { keyUnavailableMessage } from '@/core/offline/offline-copy';
import {
	type InventoryItemDto,
	type InventoryMutationItemDto,
	restockAmount,
} from '@/features/inventory/inventory';

export type RestockOutcome =
	| { kind: 'ok'; item: InventoryMutationItemDto }
	| { kind: 'gone' }
	| { kind: 'error'; message: string };

/**
 * Raises one item by its restock amount. `keys` maps `${itemId}:${amount}` to the idempotency
 * key of an unsettled request, so a retry after an unclear failure replays the same key.
 */
export async function restockItem(args: {
	shareCode: string;
	memberId: string;
	item: InventoryItemDto;
	keys: Map<string, string>;
}): Promise<RestockOutcome> {
	const { shareCode, memberId, item, keys } = args;
	const amount = restockAmount(item);
	const requestKey = `${item.id}:${amount}`;
	const idempotencyKey = keys.get(requestKey) ?? createIdempotencyKey();
	if (!idempotencyKey) {
		return {
			kind: 'error',
			message: keyUnavailableMessage('Aktualisierung', 'gesendet'),
		};
	}
	keys.set(requestKey, idempotencyKey);
	const res = await apiFetch<{ item: InventoryMutationItemDto }>(
		`/api/wg/${encodeURIComponent(shareCode)}/inventory/${encodeURIComponent(item.id)}`,
		{
			method: 'PATCH',
			memberId,
			headers: { 'Idempotency-Key': idempotencyKey },
			body: JSON.stringify({ quantityDelta: amount }),
		},
	);
	if (res.ok) {
		keys.delete(requestKey);
		return { kind: 'ok', item: res.data.item };
	}
	if (res.status === 404 && res.error === 'item_not_found') {
		keys.delete(requestKey);
		return { kind: 'gone' };
	}
	if (shouldReleaseIdempotencyKey(res.status, res.error)) keys.delete(requestKey);
	return {
		kind: 'error',
		message: mutationErrorMessage(
			'Aktualisierung fehlgeschlagen',
			res.error,
			{},
			'Aktualisierung fehlgeschlagen. Versuche es erneut.',
		),
	};
}
