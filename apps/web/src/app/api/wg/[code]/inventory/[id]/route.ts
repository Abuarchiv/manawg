import { recordAuditEvent } from '@/core/audit';
import { db, wgInventoryItems, wgInventoryLog } from '@/core/db';
import { badRequest, conflict, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { claimReplaySlotWithRetry } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	getCachedResponse,
	readIdempotencyKey,
	replayKey,
	setCachedResponse,
} from '@/core/idempotency';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
	clampQuantity,
} from '@/features/inventory/inventory';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchInventorySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(INVENTORY_LIMITS.NAME_MIN)
			.max(INVENTORY_LIMITS.NAME_MAX)
			.optional(),
		quantityDelta: z
			.number()
			.int()
			.min(-INVENTORY_LIMITS.QUANTITY_MAX)
			.max(INVENTORY_LIMITS.QUANTITY_MAX)
			.optional(),
		quantity: z
			.number()
			.int()
			.min(INVENTORY_LIMITS.QUANTITY_MIN)
			.max(INVENTORY_LIMITS.QUANTITY_MAX)
			.optional(),
		threshold: z
			.number()
			.int()
			.min(INVENTORY_LIMITS.THRESHOLD_MIN)
			.max(INVENTORY_LIMITS.THRESHOLD_MAX)
			.optional(),
		unit: z.enum(INVENTORY_UNITS).optional(),
		category: z.enum(INVENTORY_CATEGORIES).optional(),
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.quantityDelta !== undefined ||
			value.quantity !== undefined ||
			value.threshold !== undefined ||
			value.unit !== undefined ||
			value.category !== undefined,
		{ message: 'empty_update' },
	);

export const PATCH = withWgRoute<{ id: string }>('inventory PATCH', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = patchInventorySchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors, formErrors } = parsed.error.flatten();
		if (fieldErrors.name) return badRequest('name_invalid');
		if (fieldErrors.quantity || fieldErrors.quantityDelta) return badRequest('quantity_invalid');
		if (fieldErrors.threshold) return badRequest('threshold_invalid');
		if (fieldErrors.unit) return badRequest('unit_invalid');
		if (fieldErrors.category) return badRequest('category_invalid');
		if (formErrors.includes('empty_update')) return badRequest('empty_update');
		return badRequest('invalid_body');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`inventory-patch:${wgId}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const existingRows = await db
		.select()
		.from(wgInventoryItems)
		.where(and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wgId)))
		.limit(1);
	const existing = existingRows[0];
	if (!existing) return notFound('item_not_found');

	const rawIdempotencyKey = readIdempotencyKey(req);
	const replayScope = `inventory-patch:${wgId}:${auth.member.memberId}:${id}`;
	const replayKeyValue = rawIdempotencyKey ? replayKey(replayScope, rawIdempotencyKey) : null;
	if (rawIdempotencyKey && replayKeyValue) {
		const cached = await getCachedResponse<{ item: typeof existing }>(
			replayScope,
			rawIdempotencyKey,
		);
		if (cached) return NextResponse.json(cached);
		const slot = await claimReplaySlotWithRetry<{ item: typeof existing }>(
			replayScope,
			rawIdempotencyKey,
		);
		if (!slot.won) return NextResponse.json(slot.cached);
	}

	const updates: Partial<typeof wgInventoryItems.$inferInsert> = { updatedAt: new Date() };
	let nextQuantity = existing.quantity;

	if (parsed.data.quantity !== undefined) {
		nextQuantity = clampQuantity(parsed.data.quantity);
	} else if (parsed.data.quantityDelta !== undefined) {
		nextQuantity = clampQuantity(existing.quantity + parsed.data.quantityDelta);
	}

	if (nextQuantity !== existing.quantity) {
		updates.quantity = nextQuantity;
	}
	if (parsed.data.name !== undefined) updates.name = parsed.data.name;
	if (parsed.data.threshold !== undefined) updates.threshold = parsed.data.threshold;
	if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit;
	if (parsed.data.category !== undefined) updates.category = parsed.data.category;

	const updateWhere =
		parsed.data.quantity === undefined && parsed.data.quantityDelta !== undefined
			? and(
					eq(wgInventoryItems.id, id),
					eq(wgInventoryItems.wgId, wgId),
					eq(wgInventoryItems.quantity, existing.quantity),
				)
			: and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wgId));

	const [updated] = await db.update(wgInventoryItems).set(updates).where(updateWhere).returning();
	if (!updated) {
		// Delta update affected 0 rows: concurrent write changed the quantity
		// between read and write. Distinguish from genuine deletion like the
		// consume route does.
		if (parsed.data.quantity === undefined && parsed.data.quantityDelta !== undefined) {
			const stillExistsRows = await db
				.select({ id: wgInventoryItems.id })
				.from(wgInventoryItems)
				.where(and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wgId)))
				.limit(1);
			if (stillExistsRows[0]) return conflict('version_conflict');
		}
		return notFound('item_not_found');
	}

	const delta = nextQuantity - existing.quantity;
	if (delta !== 0) {
		await db.insert(wgInventoryLog).values({
			itemId: updated.id,
			memberId: auth.member.memberId,
			delta,
			kind: delta < 0 ? 'consume' : 'restock',
		});
	}

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'inventory.updated',
		entityType: 'inventory_item',
		entityId: updated.id,
		summary: `${auth.member.name} hat ${updated.name} in den Vorräten aktualisiert.`,
		metadata: {
			name: updated.name,
			delta,
			quantity: updated.quantity,
			threshold: updated.threshold,
			unit: updated.unit,
			category: updated.category,
		},
	});

	const responseBody = { item: updated };
	if (rawIdempotencyKey && replayKeyValue) {
		await setCachedResponse(replayScope, rawIdempotencyKey, responseBody);
	}
	return NextResponse.json(responseBody);
});

export const DELETE = withWgRoute<{ id: string }>('inventory DELETE', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const limitedDelete = await checkRateLimit(
		wgWriteLimiter,
		`inventory-delete:${wgId}:${auth.member.memberId}`,
	);
	if (!limitedDelete.success) return tooMany();

	const deleted = await db
		.delete(wgInventoryItems)
		.where(and(eq(wgInventoryItems.id, id), eq(wgInventoryItems.wgId, wgId)))
		.returning({ id: wgInventoryItems.id, name: wgInventoryItems.name });
	if (deleted.length === 0) return notFound('item_not_found');

	await recordAuditEvent({
		wgId,
		memberId: auth.member.memberId,
		eventType: 'inventory.deleted',
		entityType: 'inventory_item',
		entityId: id,
		summary: `${auth.member.name} hat ${deleted[0]?.name ?? 'einen Vorrat'} aus den Vorräten entfernt.`,
		metadata: { name: deleted[0]?.name ?? null },
	});

	return NextResponse.json({ deleted: true });
});
