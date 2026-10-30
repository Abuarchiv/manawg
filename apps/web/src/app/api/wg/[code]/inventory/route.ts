import { and, asc, eq, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { recordAuditEvent } from '@/core/audit';
import { db, wgInventoryItems } from '@/core/db';
import { rejectWrite, responseCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { conflict, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { requestLocale } from '@/core/i18n/request-locale';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { readListLimit } from '@/core/infra/env';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	groupItemsByCategory,
	INVENTORY_LIMITS,
	INVENTORY_LIST_LIMIT,
} from '@/features/inventory/inventory';
import { getRecentDecrementCounts } from '@/features/inventory/server/inventory-decrements';
import {
	isInventoryNameTaken,
	isInventoryNameViolation,
} from '@/features/inventory/server/inventory-duplicate';
import { createInventoryItemMutation } from '@/features/inventory/server/inventory-mutations';
import {
	inventoryCategorySchema,
	inventoryUnitSchema,
} from '@/features/inventory/server/inventory-value-schemas';

/** Hard ceiling for `INVENTORY_LIST_LIMIT` — env can lower or raise, never unbound. */
const INVENTORY_LIST_LIMIT_MAX = 5000;

const createInventorySchema = z.object({
	name: z.string().trim().min(INVENTORY_LIMITS.NAME_MIN).max(INVENTORY_LIMITS.NAME_MAX),
	quantity: z
		.number()
		.multipleOf(0.01)
		.min(INVENTORY_LIMITS.QUANTITY_MIN)
		.max(INVENTORY_LIMITS.QUANTITY_MAX)
		.default(0),
	unit: inventoryUnitSchema.default('piece'),
	threshold: z
		.number()
		.multipleOf(0.01)
		.min(INVENTORY_LIMITS.THRESHOLD_MIN)
		.max(INVENTORY_LIMITS.THRESHOLD_MAX)
		.default(1),
	category: inventoryCategorySchema.default('other'),
});

export const GET = withWgRoute('inventory GET', async (req, { code }) => {
	const url = new URL(req.url);
	const lowStockOnly = url.searchParams.get('lowStock') === 'true';
	const listLimit = readListLimit(
		process.env,
		'INVENTORY_LIST_LIMIT',
		INVENTORY_LIST_LIMIT,
		INVENTORY_LIST_LIMIT_MAX,
	);
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const items = await db
		.select()
		.from(wgInventoryItems)
		.where(
			lowStockOnly
				? and(
						eq(wgInventoryItems.wgId, wgId),
						lte(wgInventoryItems.quantity, wgInventoryItems.threshold),
					)
				: eq(wgInventoryItems.wgId, wgId),
		)
		.orderBy(asc(wgInventoryItems.category), asc(wgInventoryItems.name))
		.limit(listLimit);
	const counts = await getRecentDecrementCounts(items.map((i) => i.id));
	const enrichedItems = items.map((item) => ({
		...item,
		decrementCount30d: counts.get(item.id) ?? 0,
	}));
	return NextResponse.json({
		items: enrichedItems,
		grouped: groupItemsByCategory(enrichedItems),
	});
});

const inventoryCreateCodec = responseCodec();

export const POST = withWgRoute('inventory POST', async (req, { code }) => {
	const parsed = await parseBody(req, createInventorySchema, {
		fieldErrors: {
			name: 'name_invalid',
			quantity: 'quantity_invalid',
			unit: 'unit_invalid',
			threshold: 'threshold_invalid',
			category: 'category_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const replayScope = `inventory-create:${wgId}:${auth.member.memberId}`;

	const write = () =>
		withIdempotentWrite(
			{
				scope: replayScope,
				key: readIdempotencyKey(req),
				codec: inventoryCreateCodec,
				prepare: async () => {
					const limited = await checkRateLimit(wgWriteLimiter, replayScope);
					const blocked = rateLimitResponse(limited);
					return blocked ? { stop: blocked } : { input: undefined };
				},
			},
			async (tx) => {
				if (await isInventoryNameTaken(tx, wgId, parsed.data.name)) {
					return rejectWrite(conflict('inventory_item_duplicate'));
				}
				const mutation = await createInventoryItemMutation(tx, {
					...parsed.data,
					wgId,
					memberId: auth.member.memberId,
					locale: requestLocale(req),
				});
				if (mutation.kind !== 'ok') return rejectWrite(serverError('insert_failed'));
				return { status: 200, body: { item: mutation.item }, context: { item: mutation.item } };
			},
		);
	// The unique index catches two creates or renames racing for one name; answer it like the
	// check above, after the helper rolled back the aborted transaction.
	let result: Awaited<ReturnType<typeof write>>;
	try {
		result = await write();
	} catch (err) {
		if (isInventoryNameViolation(err)) return conflict('inventory_item_duplicate');
		throw err;
	}

	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'written' && result.context) {
		if ('rejected' in result.context) return result.context.rejected;
		const { item } = result.context;
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'inventory.created',
			entityType: 'inventory_item',
			entityId: item.id,
			actorName: auth.member.name,
			metadata: {
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				threshold: item.threshold,
				category: item.category,
			},
		});
	}
	return NextResponse.json(result.body, { status: result.status });
});
