import { recordAuditEvent } from '@/core/audit';
import { db, wgInventoryItems } from '@/core/db';
import type { WgInventoryItem } from '@/core/db/schema';
import { withTransaction } from '@/core/db/transaction';
import { badRequest, conflict, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { claimReplaySlotWithRetry } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { readJsonLimited } from '@/core/http/read-json';
import { getCachedResponse, readIdempotencyKey, releaseResponseSlot } from '@/core/idempotency';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_LIMITS,
	INVENTORY_UNITS,
} from '@/features/inventory/inventory';
import {
	completeInventoryReplay,
	updateInventoryItemMutation,
} from '@/features/inventory/inventory-mutations';
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
		expectedQuantity: z
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
		expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
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
	)
	.refine((value) => value.quantity === undefined || value.expectedUpdatedAt !== undefined, {
		message: 'expected_updated_at_required',
	})
	.refine((value) => value.quantity === undefined || value.expectedQuantity !== undefined, {
		message: 'expected_quantity_required',
	});

export const PATCH = withWgRoute<{ id: string }>('inventory PATCH', async (req, { code, id }) => {
	if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = patchInventorySchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors, formErrors } = parsed.error.flatten();
		if (fieldErrors.name) return badRequest('name_invalid');
		if (fieldErrors.quantity || fieldErrors.quantityDelta) return badRequest('quantity_invalid');
		if (fieldErrors.expectedQuantity) return badRequest('expected_quantity_invalid');
		if (fieldErrors.threshold) return badRequest('threshold_invalid');
		if (fieldErrors.unit) return badRequest('unit_invalid');
		if (fieldErrors.category) return badRequest('category_invalid');
		if (fieldErrors.expectedUpdatedAt) return badRequest('expected_updated_at_invalid');
		if (formErrors.includes('empty_update')) return badRequest('empty_update');
		if (formErrors.includes('expected_updated_at_required')) {
			return badRequest('expected_updated_at_required');
		}
		if (formErrors.includes('expected_quantity_required')) {
			return badRequest('expected_quantity_required');
		}
		return badRequest('invalid_body');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const rawIdempotencyKey = readIdempotencyKey(req);
	const replayScope = `inventory-patch:${wgId}:${auth.member.memberId}:${id}`;
	if (rawIdempotencyKey) {
		const cached = await getCachedResponse<{ item: WgInventoryItem }>(
			replayScope,
			rawIdempotencyKey,
		);
		if (cached) return NextResponse.json(cached);
	}

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`inventory-patch:${wgId}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	if (rawIdempotencyKey) {
		const slot = await claimReplaySlotWithRetry<{ item: WgInventoryItem }>(
			replayScope,
			rawIdempotencyKey,
		);
		if (!slot.won) return NextResponse.json(slot.cached);
	}

	const result = await withTransaction(async (tx) => {
		const mutation = await updateInventoryItemMutation(tx, {
			...parsed.data,
			itemId: id,
			wgId,
			memberId: auth.member.memberId,
		});
		if (mutation.kind === 'ok' && rawIdempotencyKey) {
			await completeInventoryReplay(tx, replayScope, rawIdempotencyKey, {
				item: mutation.updated,
			});
		}
		return mutation;
	});
	if (result.kind === 'not_found' || result.kind === 'conflict') {
		if (rawIdempotencyKey) await releaseResponseSlot(replayScope, rawIdempotencyKey);
		return result.kind === 'not_found' ? notFound('item_not_found') : conflict('version_conflict');
	}
	const { updated, delta, autoPushedShoppingItemId } = result;

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
			autoPushedShoppingItemId,
		},
	});

	const responseBody = { item: updated };
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
