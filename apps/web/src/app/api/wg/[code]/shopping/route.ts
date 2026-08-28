import { badRequest, conflict, serverError, tooMany } from '@/lib/api-error';
import { announcements, db, shoppingItems } from '@/lib/db';
import { dispatchNotification } from '@/lib/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/lib/rate-limit';
import { recordAuditEvent } from '@/lib/wg/audit';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const NAME_MIN = 1;
const NAME_MAX = 120;
const QUANTITY_MAX = 40;
const SHOPPING_ITEMS_UNIQUE_OPEN_NAME = 'shopping_items_unique_open_name';
const SHOPPING_ITEMS_LIST_LIMIT = 1000;

const createShoppingItemSchema = z.object({
	name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
	quantity: z.string().trim().max(QUANTITY_MAX).optional().nullable(),
	bought: z.boolean().optional(),
});

function isOpenShoppingItemDuplicate(err: unknown): boolean {
	if (!err || typeof err !== 'object' || !('code' in err)) return false;
	if ((err as { code?: unknown }).code !== '23505') return false;
	return (err as { constraint?: unknown }).constraint === SHOPPING_ITEMS_UNIQUE_OPEN_NAME;
}

export const GET = withWgRoute(
	'shopping GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const items = await db
			.select()
			.from(shoppingItems)
			.where(eq(shoppingItems.wgId, wgId))
			.orderBy(asc(shoppingItems.boughtAt), asc(shoppingItems.createdAt))
			.limit(SHOPPING_ITEMS_LIST_LIMIT);
		return NextResponse.json({ items });
	},
	{ fixture: () => NextResponse.json({ items: [] }) },
);

export const POST = withWgRoute('shopping POST', async (req, { code }) => {
	let raw: unknown;
	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const parsed = createShoppingItemSchema.safeParse(raw);
	if (!parsed.success) {
		const { fieldErrors } = parsed.error.flatten();
		if (fieldErrors.quantity) return badRequest('quantity_invalid');
		if (fieldErrors.bought) return badRequest('bought_invalid');
		return badRequest('name_invalid');
	}

	const { name, quantity = null, bought = false } = parsed.data;
	const safeQuantity = typeof quantity === 'string' && quantity.length > 0 ? quantity : null;

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;

	// Per-member write cap on top of the middleware's per-IP limit. Creating an
	// item fans out to a system announcement and a push to every other member,
	// so without a member-scoped bucket a single member could rotate IPs to spam
	// the whole WG. Same 30/min ceiling as the middleware, so it can only reject
	// a request a normal single-IP user could already not make.
	const limited = await checkRateLimit(
		wgWriteLimiter,
		`shopping:create:${wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	// SECURITY: addedBy is always the authenticated caller. Any body-supplied
	// member id is ignored to prevent attribution spoofing.
	const addedBy = auth.member.memberId;

	let item: typeof shoppingItems.$inferSelect | undefined;
	try {
		[item] = await db
			.insert(shoppingItems)
			.values({
				wgId: wg.id,
				addedByMemberId: addedBy,
				name,
				quantity: safeQuantity,
				boughtAt: bought ? new Date() : null,
				boughtByMemberId: bought ? addedBy : null,
			})
			.returning();
	} catch (insertErr) {
		if (isOpenShoppingItemDuplicate(insertErr)) {
			return conflict('shopping_item_duplicate');
		}
		throw insertErr;
	}
	if (!item) return serverError('insert_failed');
	await recordAuditEvent({
		wgId: wg.id,
		memberId: auth.member.memberId,
		eventType: 'shopping.created',
		entityType: 'shopping_item',
		entityId: item.id,
		summary: `${auth.member.name} hat ${name} auf die Einkaufsliste gesetzt.`,
		metadata: {
			title: name,
			quantity: safeQuantity,
		},
	});
	try {
		await db.insert(announcements).values({
			wgId: wg.id,
			authorMemberId: addedBy,
			kind: 'request',
			source: 'shopping',
			sourcePath: `/einkauf?highlight=${encodeURIComponent(item.id)}`,
			content: `${auth.member.name} hat ${safeQuantity ? `${name} (${safeQuantity})` : name} auf die Einkaufsliste gesetzt.`,
		});
	} catch (announcementErr) {
		console.warn('[shopping POST] system announcement failed', announcementErr);
	}
	void dispatchNotification({
		wg,
		event: 'shopping.added',
		payload: { title: name, actorName: auth.member.name, shoppingItemId: item.id },
		excludeMemberId: auth.member.memberId,
	}).catch((err) => console.error('[shopping POST] notification failed', err));
	return NextResponse.json({ item });
});

export const DELETE = withWgRoute('shopping DELETE', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`shopping:clear-bought:${wgId}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const deleted = await db
		.delete(shoppingItems)
		.where(and(eq(shoppingItems.wgId, wgId), isNotNull(shoppingItems.boughtAt)))
		.returning({ id: shoppingItems.id, name: shoppingItems.name });
	if (deleted.length > 0) {
		await recordAuditEvent({
			wgId,
			memberId: auth.member.memberId,
			eventType: 'shopping.cleared_bought',
			entityType: 'shopping_item',
			entityId: null,
			summary: `${auth.member.name} hat ${deleted.length} erledigte Einkaufseinträge entfernt.`,
			metadata: {
				count: deleted.length,
				items: deleted.slice(0, 20).map((item) => item.name),
			},
		});
	}

	return NextResponse.json({ deleted: deleted.length });
});
