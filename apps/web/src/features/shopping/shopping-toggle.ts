import type { OfflineAction } from '@/core/offline/offline-queue';
import type { ShoppingItem } from '@/features/shopping/components/shopping-types';
import { keepItems } from '@/features/shopping/shopping-view';

/** A PATCH that checks the item off (or reopens it) only if nobody changed it meanwhile. */
export interface ShoppingPatchRequest {
	expectedUpdatedAt: string;
	expectedBoughtAt: string | null;
	fingerprint: string;
	idempotencyKey: string;
}

export type ShoppingPatchPlan =
	| { ok: true; request: ShoppingPatchRequest }
	| { ok: false; reason: 'version_missing' | 'key_unavailable' };

/**
 * Builds the toggle request for a server item. A retry of the same toggle on the same version
 * reuses the earlier idempotency key, so an ambiguous first attempt is not applied twice.
 */
export function planShoppingPatch(
	item: ShoppingItem,
	bought: boolean,
	previous: { fingerprint: string; key: string } | undefined,
	createKey: () => string | null,
): ShoppingPatchPlan {
	if (!item.updatedAt) return { ok: false, reason: 'version_missing' };
	const fingerprint = JSON.stringify({
		expectedUpdatedAt: item.updatedAt,
		expectedBoughtAt: item.boughtAt,
		bought,
	});
	const idempotencyKey = previous?.fingerprint === fingerprint ? previous.key : createKey();
	if (!idempotencyKey) return { ok: false, reason: 'key_unavailable' };
	return {
		ok: true,
		request: {
			expectedUpdatedAt: item.updatedAt,
			expectedBoughtAt: item.boughtAt,
			fingerprint,
			idempotencyKey,
		},
	};
}

/** The row as it looks right after the tap, before the server confirms it. */
export function toggledShoppingItem(
	item: ShoppingItem,
	bought: boolean,
	memberId: string,
	now: Date,
): ShoppingItem {
	return {
		...item,
		boughtAt: bought ? now.toISOString() : null,
		boughtByMemberId: bought ? memberId : null,
	};
}

interface QueuedCreateTarget {
	itemId: string;
	shareCode: string;
	memberId: string;
}

function isQueuedCreate(action: OfflineAction, target: QueuedCreateTarget): boolean {
	return (
		action.id === target.itemId &&
		action.shareCode === target.shareCode &&
		action.memberId === target.memberId &&
		action.type === 'shopping.create'
	);
}

/**
 * Marks a not-yet-synced create as bought (or open) inside the queue, so it reaches the server in
 * its final state. Returns null when the create is not queued (anymore).
 */
export function withQueuedCreateBought(
	actions: OfflineAction[],
	target: QueuedCreateTarget,
	bought: boolean,
): OfflineAction[] | null {
	if (!actions.some((action) => isQueuedCreate(action, target))) return null;
	return actions.map((action) =>
		isQueuedCreate(action, target) ? { ...action, payload: { ...action.payload, bought } } : action,
	);
}

/** `items` with one row replaced, keeping the array identity when nothing changed. */
export function replaceShoppingItem(
	items: ShoppingItem[],
	id: string,
	replacement: ShoppingItem,
): ShoppingItem[] {
	return keepItems(
		items,
		items.map((item) => (item.id === id ? replacement : item)),
	);
}

/** `items` without the rows `drop` matches, keeping the array identity when nothing changed. */
export function dropShoppingItems(
	items: ShoppingItem[],
	drop: (item: ShoppingItem) => boolean,
): ShoppingItem[] {
	return keepItems(
		items,
		items.filter((item) => !drop(item)),
	);
}
