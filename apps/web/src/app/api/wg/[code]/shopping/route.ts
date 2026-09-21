import { postSystemNotice } from '@/core/activity-feed';
import { recordAuditEvent } from '@/core/audit';
import { db, shoppingItems } from '@/core/db';
import { badRequest, conflict, serverError, tooMany } from '@/core/errors';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { getCachedResponse, readIdempotencyKey, setCachedResponse } from '@/core/idempotency';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { isOpenShoppingItemDuplicate } from '@/features/shopping/shopping-duplicate';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const NAME_MIN = 1;
const NAME_MAX = 120;
const QUANTITY_MAX = 40;
const SHOPPING_ITEMS_LIST_LIMIT = 1000;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

type ShoppingCreateWarning =
	| null
	| 'notification_delivery_failed'
	| 'notification_delivery_unknown';

type ShoppingCreateResponseBody = { item: unknown; warning: ShoppingCreateWarning };

const shoppingCreateReplay = new ReplayCache<ShoppingCreateResponseBody>(IDEMPOTENCY_TTL_MS);

function shoppingCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `shopping-create:${wgId}:${memberId}`;
}

const createShoppingItemSchema = z.object({
	name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
	quantity: z.string().trim().max(QUANTITY_MAX).optional().nullable(),
	bought: z.boolean().optional(),
});

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
	let replayReservation: Extract<
		ReplayReservation<ShoppingCreateResponseBody>,
		{ owned: true }
	> | null = null;
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
	const idemKey = readIdempotencyKey(req);

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const idemScope = idemKey ? shoppingCreateIdempotencyScope(wg.id, auth.member.memberId) : null;
	const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;
	if (idemScope && idemKey && idemReplayKey) {
		const localReplay = shoppingCreateReplay.get(idemReplayKey);
		if (localReplay) return NextResponse.json(await localReplay);

		const cached = await getCachedResponse<ShoppingCreateResponseBody>(idemScope, idemKey);
		if (cached) {
			shoppingCreateReplay.remember(idemReplayKey, cached);
			return NextResponse.json(cached);
		}
	}

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
	const replaySlot = idemReplayKey === null ? null : shoppingCreateReplay.reserve(idemReplayKey);
	if (replaySlot?.owned === false) return NextResponse.json(await replaySlot.promise);
	replayReservation = replaySlot;

	try {
		if (idemScope && idemKey) {
			const slot = await claimReplaySlotWithRetry<ShoppingCreateResponseBody>(idemScope, idemKey);
			if (!slot.won) {
				replayReservation?.resolve(slot.cached);
				return NextResponse.json(slot.cached);
			}
		}

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
				replayReservation?.reject(insertErr);
				return conflict('shopping_item_duplicate');
			}
			throw insertErr;
		}
		if (!item) {
			const err = new Error('insert_failed');
			replayReservation?.reject(err);
			return serverError('insert_failed');
		}
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
		await postSystemNotice({
			wgId: wg.id,
			authorMemberId: addedBy,
			kind: 'request',
			source: 'shopping',
			sourcePath: `/einkauf?highlight=${encodeURIComponent(item.id)}`,
			content: `${auth.member.name} hat ${safeQuantity ? `${name} (${safeQuantity})` : name} auf die Einkaufsliste gesetzt.`,
		});
		const { warning } = await dispatchNotificationSafely({
			wg,
			event: 'shopping.added',
			payload: { title: name, actorName: auth.member.name, shoppingItemId: item.id },
			excludeMemberId: auth.member.memberId,
		});
		const responseBody = { item, warning };
		if (idemScope && idemKey && replayReservation?.owned) {
			replayReservation.resolve(responseBody);
			void setCachedResponse(idemScope, idemKey, responseBody).catch((err) =>
				console.warn('[shopping POST] idem cache write failed', err),
			);
		}
		return NextResponse.json(responseBody);
	} catch (err) {
		replayReservation?.reject(err);
		throw err;
	}
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
