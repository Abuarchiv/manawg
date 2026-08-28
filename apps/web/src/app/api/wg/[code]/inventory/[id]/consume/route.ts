import { recordAuditEvent } from '@/core/audit';
import { db, shoppingItems, wgInventoryItems, wgInventoryLog } from '@/core/db';
import { badRequest, conflict, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	INVENTORY_LIMITS,
	buildShoppingPushPayload,
	clampQuantity,
	isBelowThreshold,
	normalizeForMatch,
} from '@/lib/wg/inventory';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const consumeSchema = z.object({
	delta: z
		.number()
		.int()
		.min(INVENTORY_LIMITS.CONSUME_DELTA_MIN)
		.max(INVENTORY_LIMITS.CONSUME_DELTA_MAX),
});

export const POST = withWgRoute<{ id: string }>('inventory consume', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = consumeSchema.safeParse(raw);
	if (!parsed.success) {
		return badRequest('delta_invalid');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`inventory-consume:${wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const existingRows = await db
		.select()
		.from(wgInventoryItems)
		.where(and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wg.id)))
		.limit(1);
	const existing = existingRows[0];
	if (!existing) return notFound('item_not_found');

	const requestedQuantity = existing.quantity + parsed.data.delta;
	const nextQuantity = clampQuantity(requestedQuantity);
	const appliedDelta = nextQuantity - existing.quantity;
	const wasAlreadyBelowThreshold = isBelowThreshold(existing);

	const now = new Date();
	const [updated] = await db
		.update(wgInventoryItems)
		.set({
			quantity: nextQuantity,
			lastDecrementedAt: appliedDelta < 0 ? now : existing.lastDecrementedAt,
			updatedAt: now,
		})
		.where(
			and(
				eq(wgInventoryItems.id, id),
				eq(wgInventoryItems.wgId, wg.id),
				eq(wgInventoryItems.quantity, existing.quantity),
			),
		)
		.returning();
	if (!updated) {
		// Row existed at the initial read but the version-stamped UPDATE affected
		// 0 rows: a concurrent write changed the quantity between read and write.
		// Distinguish this from genuine "item was deleted" by re-checking existence.
		const stillExistsRows = await db
			.select({ id: wgInventoryItems.id })
			.from(wgInventoryItems)
			.where(and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wg.id)))
			.limit(1);
		if (stillExistsRows[0]) return conflict('version_conflict');
		return notFound('item_not_found');
	}

	if (appliedDelta !== 0) {
		await db.insert(wgInventoryLog).values({
			itemId: updated.id,
			memberId: auth.member.memberId,
			delta: appliedDelta,
			kind: 'consume',
		});
	}

	const clamped = requestedQuantity !== nextQuantity;

	let autoPushedShoppingItemId: string | null = null;
	const justCrossedThreshold = !wasAlreadyBelowThreshold && isBelowThreshold(updated);
	const stillBelowThreshold = isBelowThreshold(updated);

	if (stillBelowThreshold) {
		// Belt-and-suspenders dedup:
		// 1. Pre-check for an open shopping row with the same normalized name.
		// 2. Insert with onConflictDoNothing using the partial unique index
		//    `shopping_items_unique_open_name` so two concurrent consume calls
		//    cannot both insert a duplicate open row.
		const normalizedName = normalizeForMatch(updated.name);
		const openShoppingRows = await db
			.select({ id: shoppingItems.id, name: shoppingItems.name })
			.from(shoppingItems)
			.where(and(eq(shoppingItems.wgId, wg.id), isNull(shoppingItems.boughtAt)));
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
			const created = await db
				.insert(shoppingItems)
				.values({
					wgId: wg.id,
					addedByMemberId: auth.member.memberId,
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

	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'inventory.consumed',
		entityType: 'inventory_item',
		entityId: updated.id,
		summary: `${auth.member.name} hat ${Math.abs(appliedDelta)} ${updated.unit} ${updated.name} entnommen.`,
		metadata: {
			name: updated.name,
			appliedDelta,
			requestedDelta: parsed.data.delta,
			quantity: updated.quantity,
			threshold: updated.threshold,
			clamped,
			autoPushedShoppingItemId,
		},
	});

	if (justCrossedThreshold || autoPushedShoppingItemId !== null) {
		void dispatchNotification({
			wg,
			event: 'inventory.low_stock',
			payload: {
				title: updated.name,
				actorName: auth.member.name,
				quantity: updated.quantity,
				threshold: updated.threshold,
				unit: updated.unit,
				inventoryItemId: updated.id,
				shoppingItemId: autoPushedShoppingItemId,
			},
			excludeMemberId: auth.member.memberId,
		}).catch((err) => console.error('[inventory consume] notification failed', err));
	}

	return NextResponse.json({
		item: updated,
		clamped,
		autoPushedShoppingItemId,
	});
});
