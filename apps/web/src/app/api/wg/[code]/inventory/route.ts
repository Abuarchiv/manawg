import { recordAuditEvent } from '@/core/audit';
import { db, wgInventoryItems } from '@/core/db';
import { withTransaction } from '@/core/db/transaction';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, serverError, tooMany } from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { getCachedResponse, readIdempotencyKey } from '@/core/idempotency-store';
import { readListLimit } from '@/core/infra/env';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_LIMITS,
	INVENTORY_LIST_LIMIT,
	INVENTORY_UNITS,
	groupItemsByCategory,
} from '@/features/inventory/inventory';
import { getRecentDecrementCounts } from '@/features/inventory/inventory-decrements';
import {
	completeInventoryReplay,
	createInventoryItemMutation,
} from '@/features/inventory/inventory-mutations';
import { and, asc, eq, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/** Hard ceiling for `INVENTORY_LIST_LIMIT` — env can lower or raise, never unbound. */
const INVENTORY_LIST_LIMIT_MAX = 5000;

const createInventorySchema = z.object({
	name: z.string().trim().min(INVENTORY_LIMITS.NAME_MIN).max(INVENTORY_LIMITS.NAME_MAX),
	quantity: z
		.number()
		.int()
		.min(INVENTORY_LIMITS.QUANTITY_MIN)
		.max(INVENTORY_LIMITS.QUANTITY_MAX)
		.default(0),
	unit: z.enum(INVENTORY_UNITS).default('Stück'),
	threshold: z
		.number()
		.int()
		.min(INVENTORY_LIMITS.THRESHOLD_MIN)
		.max(INVENTORY_LIMITS.THRESHOLD_MAX)
		.default(1),
	category: z.enum(INVENTORY_CATEGORIES).default('sonstiges'),
});

export const GET = withWgRoute(
	'inventory GET',
	async (req, { code }) => {
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
	},
	{
		fixture: () => {
			const items: never[] = [];
			return NextResponse.json(
				{ items, grouped: groupItemsByCategory(items) },
				{ headers: { 'Cache-Control': 'private, no-store' } },
			);
		},
	},
);

export const POST = withWgRoute('inventory POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await readJsonLimited(req);
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = createInventorySchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.name) return badRequest('name_invalid');
		if (fieldErrors.quantity) return badRequest('quantity_invalid');
		if (fieldErrors.unit) return badRequest('unit_invalid');
		if (fieldErrors.threshold) return badRequest('threshold_invalid');
		if (fieldErrors.category) return badRequest('category_invalid');
		return badRequest('invalid_body');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;
	const replayScope = `inventory-create:${wgId}:${auth.member.memberId}`;
	const replayKey = readIdempotencyKey(req);
	if (replayKey) {
		const cached = await getCachedResponse<{ status: number; body: unknown }>(
			replayScope,
			replayKey,
		);
		if (cached) return NextResponse.json(cached.body, { status: cached.status });
	}
	const limited = await checkRateLimit(wgWriteLimiter, replayScope);
	if (!limited.success) return tooMany();

	return withIdempotentJsonResponse(req, replayScope, async () => {
		const result = await withTransaction(async (tx) => {
			const mutation = await createInventoryItemMutation(tx, {
				...parsed.data,
				wgId,
				memberId: auth.member.memberId,
			});
			if (mutation.kind === 'ok' && replayKey) {
				await completeInventoryReplay(tx, replayScope, replayKey, {
					status: 200,
					body: { item: mutation.item },
				});
			}
			return mutation;
		});
		if (result.kind !== 'ok') return serverError('insert_failed');
		const { item } = result;

		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'inventory.created',
			entityType: 'inventory_item',
			entityId: item.id,
			summary: `${auth.member.name} hat ${item.name} zu den Vorräten hinzugefügt.`,
			metadata: {
				name: item.name,
				quantity: item.quantity,
				unit: item.unit,
				threshold: item.threshold,
				category: item.category,
			},
		});

		return NextResponse.json({ item });
	});
});
