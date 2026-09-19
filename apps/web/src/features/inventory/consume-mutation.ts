import { shoppingItems, wgInventoryItems, wgInventoryLog } from '@/core/db';
import type { WgInventoryItem, WgMember } from '@/core/db/schema';
import type { DbTransaction } from '@/core/db/transaction';
import {
	buildShoppingPushPayload,
	clampQuantity,
	isBelowThreshold,
	normalizeForMatch,
} from '@/features/inventory/inventory';
import { and, eq, isNull, sql } from 'drizzle-orm';

export type ConsumeInventoryMutationInput = {
	itemId: WgInventoryItem['id'];
	wgId: WgInventoryItem['wgId'];
	memberId: WgMember['id'];
	delta: number;
};

export async function consumeInventoryMutation(
	tx: DbTransaction,
	input: ConsumeInventoryMutationInput,
) {
	const existingRows = await tx
		.select()
		.from(wgInventoryItems)
		.where(and(eq(wgInventoryItems.id, input.itemId), eq(wgInventoryItems.wgId, input.wgId)))
		.limit(1);
	const existing = existingRows[0];
	if (!existing) return { kind: 'not_found' as const };

	const requestedQuantity = existing.quantity + input.delta;
	const nextQuantity = clampQuantity(requestedQuantity);
	const appliedDelta = nextQuantity - existing.quantity;
	const wasAlreadyBelowThreshold = isBelowThreshold(existing);
	const now = new Date();
	const [updated] = await tx
		.update(wgInventoryItems)
		.set({
			quantity: nextQuantity,
			lastDecrementedAt: appliedDelta < 0 ? now : existing.lastDecrementedAt,
			updatedAt: now,
		})
		.where(
			and(
				eq(wgInventoryItems.id, input.itemId),
				eq(wgInventoryItems.wgId, input.wgId),
				eq(wgInventoryItems.quantity, existing.quantity),
			),
		)
		.returning();
	if (!updated) return { kind: 'conflict' as const };

	if (appliedDelta !== 0) {
		await tx.insert(wgInventoryLog).values({
			itemId: updated.id,
			memberId: input.memberId,
			delta: appliedDelta,
			kind: 'consume',
		});
	}

	let autoPushedShoppingItemId: string | null = null;
	if (isBelowThreshold(updated)) {
		const normalizedName = normalizeForMatch(updated.name);
		const openShoppingRows = await tx
			.select({ id: shoppingItems.id, name: shoppingItems.name })
			.from(shoppingItems)
			.where(and(eq(shoppingItems.wgId, input.wgId), isNull(shoppingItems.boughtAt)));
		const alreadyOpen = openShoppingRows.some(
			(row) => normalizeForMatch(row.name) === normalizedName,
		);
		if (!alreadyOpen) {
			const payload = buildShoppingPushPayload({
				name: updated.name,
				quantity: updated.quantity,
				threshold: updated.threshold,
				unit: updated.unit,
			});
			const created = await tx
				.insert(shoppingItems)
				.values({
					wgId: input.wgId,
					addedByMemberId: input.memberId,
					name: payload.name,
					quantity: payload.quantity,
				})
				.onConflictDoNothing({
					target: [shoppingItems.wgId, shoppingItems.normalizedName],
					where: sql`${shoppingItems.boughtAt} IS NULL`,
				})
				.returning({ id: shoppingItems.id });
			autoPushedShoppingItemId = created[0]?.id ?? null;
		}
	}

	return {
		kind: 'ok' as const,
		updated,
		appliedDelta,
		clamped: requestedQuantity !== nextQuantity,
		justCrossedThreshold: !wasAlreadyBelowThreshold && isBelowThreshold(updated),
		autoPushedShoppingItemId,
	};
}
