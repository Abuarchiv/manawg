import { recordAuditEvent } from '@/core/audit';
import { db, wgInventoryItems } from '@/core/db';
import { badRequest, serverError, tooMany } from '@/core/errors';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	INVENTORY_CATEGORIES,
	INVENTORY_LIMITS,
	INVENTORY_LIST_LIMIT,
	INVENTORY_UNITS,
	groupItemsByCategory,
	isBelowThreshold,
} from '@/features/inventory/inventory';
import { getRecentDecrementCounts } from '@/features/inventory/inventory-decrements';
import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const rawItems = await db
			.select()
			.from(wgInventoryItems)
			.where(eq(wgInventoryItems.wgId, wgId))
			.orderBy(asc(wgInventoryItems.category), asc(wgInventoryItems.name))
			.limit(INVENTORY_LIST_LIMIT);
		const filtered = lowStockOnly ? rawItems.filter((item) => isBelowThreshold(item)) : rawItems;
		const counts = await getRecentDecrementCounts(filtered.map((i) => i.id));
		const items = filtered.map((item) => ({
			...item,
			decrementCount30d: counts.get(item.id) ?? 0,
		}));
		return NextResponse.json({ items, grouped: groupItemsByCategory(items) });
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
		raw = await req.json();
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

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`inventory-create:${wgId}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const [item] = await db
		.insert(wgInventoryItems)
		.values({
			wgId,
			name: parsed.data.name,
			quantity: parsed.data.quantity,
			unit: parsed.data.unit,
			threshold: parsed.data.threshold,
			category: parsed.data.category,
		})
		.returning();
	if (!item) return serverError('insert_failed');

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
