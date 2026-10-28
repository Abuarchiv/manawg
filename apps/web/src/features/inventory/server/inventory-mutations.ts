import 'server-only';
import { shoppingItems, wgInventoryItems, wgInventoryLog } from '@/core/db';
import { rowHoldsPatch } from '@/core/db/row-holds-patch';
import type { WgInventoryItem } from '@/core/db/schema-inventory';
import type { DbTransaction } from '@/core/db/transaction';
import {
	buildShoppingPushPayload,
	clampQuantity,
	isBelowThreshold,
	roundQuantity,
} from '@/features/inventory/inventory';
import { and, eq, sql } from 'drizzle-orm';

type InventoryItemInput = Pick<
	WgInventoryItem,
	'wgId' | 'name' | 'quantity' | 'unit' | 'threshold' | 'category'
>;

export async function pushBelowThresholdItemToShopping(
	tx: DbTransaction,
	item: Pick<WgInventoryItem, 'name' | 'quantity' | 'threshold' | 'unit'>,
	wgId: string,
	memberId: string,
): Promise<string | null> {
	if (!isBelowThreshold(item)) return null;
	const payload = buildShoppingPushPayload(item);
	const [created] = await tx
		.insert(shoppingItems)
		.values({
			wgId,
			addedByMemberId: memberId,
			name: payload.name,
			quantity: payload.quantity,
		})
		.onConflictDoNothing({
			target: [shoppingItems.wgId, shoppingItems.normalizedName],
			where: sql`${shoppingItems.boughtAt} IS NULL`,
		})
		.returning({ id: shoppingItems.id });
	return created?.id ?? null;
}

export async function createInventoryItemMutation(
	tx: DbTransaction,
	input: InventoryItemInput & { memberId: string },
) {
	const [item] = await tx
		.insert(wgInventoryItems)
		.values({
			wgId: input.wgId,
			name: input.name,
			quantity: input.quantity,
			unit: input.unit,
			threshold: input.threshold,
			category: input.category,
		})
		.returning();
	if (!item) return { kind: 'insert_failed' as const };

	const autoPushedShoppingItemId = await pushBelowThresholdItemToShopping(
		tx,
		item,
		input.wgId,
		input.memberId,
	);
	return { kind: 'ok' as const, item, autoPushedShoppingItemId };
}

export type UpdateInventoryItemMutationInput = {
	itemId: string;
	wgId: string;
	memberId: string;
	name?: string | undefined;
	quantityDelta?: number | undefined;
	quantity?: number | undefined;
	expectedQuantity?: number | undefined;
	threshold?: number | undefined;
	unit?: string | undefined;
	category?: string | undefined;
	expectedUpdatedAt?: string | undefined;
};

/** The retry of a save whose answer got lost finds its own values in place: no conflict then. */
function conflictUnlessHeld(stored: WgInventoryItem, input: UpdateInventoryItemMutationInput) {
	// A relative +/- never shows in the row, so it cannot be told apart from a lost update.
	const held =
		input.quantityDelta === undefined &&
		rowHoldsPatch(stored, {
			quantity: input.quantity === undefined ? undefined : clampQuantity(input.quantity),
			name: input.name,
			threshold: input.threshold,
			unit: input.unit,
			category: input.category,
		});
	return held ? { kind: 'held' as const, item: stored } : { kind: 'conflict' as const };
}

export async function updateInventoryItemMutation(
	tx: DbTransaction,
	input: UpdateInventoryItemMutationInput,
) {
	const existingQuery = tx
		.select()
		.from(wgInventoryItems)
		.where(and(eq(wgInventoryItems.id, input.itemId), eq(wgInventoryItems.wgId, input.wgId)))
		.limit(1);
	// A relative +/- tap has no stale state to conflict on: lock the row so
	// concurrent taps apply one after another (and log their exact delta)
	// instead of failing the optimistic quantity check below with a 409.
	const isDeltaOnly = input.quantity === undefined && input.quantityDelta !== undefined;
	const existingRows = await (isDeltaOnly ? existingQuery.for('update') : existingQuery);
	const existing = existingRows[0];
	if (!existing) return { kind: 'not_found' as const };

	if (input.quantity !== undefined) {
		if (!input.expectedUpdatedAt || input.expectedQuantity === undefined) {
			return { kind: 'conflict' as const };
		}
		if (
			existing.quantity !== input.expectedQuantity ||
			existing.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()
		) {
			return conflictUnlessHeld(existing, input);
		}
	}

	const updates: Partial<typeof wgInventoryItems.$inferInsert> = { updatedAt: new Date() };
	let nextQuantity = existing.quantity;
	if (input.quantity !== undefined) {
		nextQuantity = clampQuantity(input.quantity);
	} else if (input.quantityDelta !== undefined) {
		nextQuantity = clampQuantity(existing.quantity + input.quantityDelta);
	}

	if (nextQuantity !== existing.quantity) updates.quantity = nextQuantity;
	if (input.name !== undefined) updates.name = input.name;
	if (input.threshold !== undefined) updates.threshold = input.threshold;
	if (input.unit !== undefined) updates.unit = input.unit;
	if (input.category !== undefined) updates.category = input.category;

	const updateConditions = [
		eq(wgInventoryItems.id, input.itemId),
		eq(wgInventoryItems.wgId, input.wgId),
		eq(wgInventoryItems.quantity, existing.quantity),
	];
	if (input.expectedUpdatedAt) {
		updateConditions.push(
			sql`date_trunc('milliseconds', ${wgInventoryItems.updatedAt}) = ${new Date(input.expectedUpdatedAt)}`,
		);
	}
	const [updated] = await tx
		.update(wgInventoryItems)
		.set(updates)
		.where(and(...updateConditions))
		.returning();
	if (!updated) {
		const stillExistsRows = await tx
			.select()
			.from(wgInventoryItems)
			.where(and(eq(wgInventoryItems.id, input.itemId), eq(wgInventoryItems.wgId, input.wgId)))
			.limit(1);
		const stored = stillExistsRows[0];
		return stored ? conflictUnlessHeld(stored, input) : { kind: 'not_found' as const };
	}

	const delta = roundQuantity(nextQuantity - existing.quantity);
	if (delta !== 0) {
		await tx.insert(wgInventoryLog).values({
			itemId: updated.id,
			memberId: input.memberId,
			delta,
			kind: delta < 0 ? 'consume' : 'restock',
		});
	}

	// Only crossing the threshold restocks the shopping list. Renaming an item
	// that is already low, or a partial restock that stays low, must not bring
	// back an entry someone deleted or already bought.
	const crossedThreshold = !isBelowThreshold(existing) && isBelowThreshold(updated);
	const autoPushedShoppingItemId = crossedThreshold
		? await pushBelowThresholdItemToShopping(tx, updated, input.wgId, input.memberId)
		: null;
	return { kind: 'ok' as const, updated, delta, autoPushedShoppingItemId };
}
