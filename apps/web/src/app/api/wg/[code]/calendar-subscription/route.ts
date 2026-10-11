import { recordAuditEvent } from '@/core/audit';
import { calendarSubscriptions, db } from '@/core/db';
import { type ActiveAccountMember, lockActiveAccountMember } from '@/core/db/account-deletion';
import {
	type ReplayCodec,
	type StoredResponse,
	responseCodec,
	withIdempotentWrite,
} from '@/core/db/idempotent-write';
import { type DbTransaction, TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { serverError, tooMany } from '@/core/http/api-errors';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	calendarFeedUrl,
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
} from '@/features/events/server/calendar-subscription';
import { getAppUrl } from '@/shared/lib/app-url';
import { and, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

type CalendarSubscriptionRow = typeof calendarSubscriptions.$inferSelect;
type MutationResult = {
	response: StoredResponse;
	audit?: Parameters<typeof recordAuditEvent>[0];
};

// Rows written before responses were stored with their status hold the bare body.
const storedCodec = responseCodec<unknown>((stored) =>
	'subscription' in stored || (stored as { revoked?: unknown }).revoked === true
		? { status: 200, body: stored }
		: null,
);

function withoutFeedUrl(body: unknown): unknown {
	if (!body || typeof body !== 'object' || !('subscription' in body)) return body;
	const { subscription } = body as { subscription: unknown };
	if (!subscription || typeof subscription !== 'object') return body;
	const { feedUrl: _feedUrl, ...rest } = subscription as { feedUrl?: unknown };
	return { ...body, subscription: rest };
}

// The feed URL carries the secret token, so it is never stored: a replay derives it from the
// member's current subscription instead, which also keeps it correct after a later rotation.
const calendarCodec: ReplayCodec<unknown> = {
	decode: (stored) => storedCodec.decode(stored),
	encode: (response) => storedCodec.encode({ ...response, body: withoutFeedUrl(response.body) }),
};

function memberDeactivated(): NextResponse {
	return NextResponse.json({ error: 'member_deactivated' }, { status: 401 });
}

/**
 * Runs a calendar feed mutation behind the caller's locked member row. Every outcome is stored
 * for replay, including "not found" and "member deactivated".
 */
async function withCalendarMutation(
	req: NextRequest,
	scope: string,
	auth: { wg: { id: string }; member: { memberId: string }; authUserId: string },
	mutate: (tx: DbTransaction, member: ActiveAccountMember) => Promise<MutationResult>,
): Promise<NextResponse> {
	const lockMember = (tx: DbTransaction) =>
		lockActiveAccountMember(tx, auth.wg.id, auth.member.memberId, auth.authUserId);
	let member: ActiveAccountMember | null = null;
	try {
		const result = await withIdempotentWrite(
			{
				scope,
				key: readIdempotencyKey(req),
				codec: calendarCodec,
				storeStatus: () => true,
				beforeReplay: async () =>
					(await withTransaction(lockMember)) ? null : memberDeactivated(),
				inTransaction: (work) =>
					withTransaction(async (tx) => {
						member = await lockMember(tx);
						return work(tx);
					}),
			},
			async (tx) => {
				const outcome: MutationResult = member
					? await mutate(tx, member)
					: { response: { status: 401, body: { error: 'member_deactivated' } } };
				return { ...outcome.response, context: outcome.audit };
			},
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'written' && result.context) await recordAuditEvent(result.context);
		if (result.kind === 'replayed' && result.status === 200) {
			const body = withoutFeedUrl(result.body);
			if (body && typeof body === 'object' && 'subscription' in body) {
				const row = await findActiveSubscription(auth.wg.id, auth.member.memberId);
				return NextResponse.json(
					{ ...body, subscription: row ? responseFor(row) : null },
					{ status: 200 },
				);
			}
		}
		return NextResponse.json(result.body, { status: result.status });
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
}

function responseFor(row: CalendarSubscriptionRow): {
	feedUrl: string;
	createdAt: string;
	updatedAt: string;
} {
	const token = deriveCalendarFeedToken(row.id, row.tokenSeed);
	if (!token) throw new Error('calendar_feed_secret_missing');
	return {
		feedUrl: calendarFeedUrl(getAppUrl(), row.id, token),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

function findActiveSubscription(wgId: string, memberId: string) {
	return db.query.calendarSubscriptions.findFirst({
		where: and(
			eq(calendarSubscriptions.wgId, wgId),
			eq(calendarSubscriptions.memberId, memberId),
			isNull(calendarSubscriptions.revokedAt),
		),
	});
}

export const GET = withWgRoute('calendar subscription GET', async (req, { code }) => {
	const limit = await checkRateLimit(wgReadLimiter, `calendar-subscription:${clientIpKey(req)}`);
	if (!limit.success) return tooMany('rate_limited');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const row = await findActiveSubscription(auth.wg.id, auth.member.memberId);
	return NextResponse.json(
		{ subscription: row ? responseFor(row) : null },
		{ headers: { 'Cache-Control': 'private, no-store' } },
	);
});

export const POST = withWgRoute('calendar subscription POST', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-create:${auth.wg.id}:${auth.member.memberId}`,
		auth,
		async (tx, member) => {
			const [existing] = await tx
				.select()
				.from(calendarSubscriptions)
				.where(
					and(
						eq(calendarSubscriptions.wgId, auth.wg.id),
						eq(calendarSubscriptions.memberId, auth.member.memberId),
					),
				)
				.limit(1)
				.for('update');
			const now = new Date();
			let row: CalendarSubscriptionRow | undefined;
			if (existing?.revokedAt) {
				[row] = await tx
					.update(calendarSubscriptions)
					.set({ tokenSeed: createCalendarFeedSeed(), revokedAt: null, updatedAt: now })
					.where(
						and(
							eq(calendarSubscriptions.id, existing.id),
							eq(calendarSubscriptions.wgId, auth.wg.id),
							eq(calendarSubscriptions.memberId, auth.member.memberId),
						),
					)
					.returning();
			} else if (existing) {
				row = existing;
			} else {
				const id = crypto.randomUUID();
				[row] = await tx
					.insert(calendarSubscriptions)
					.values({
						id,
						wgId: auth.wg.id,
						memberId: auth.member.memberId,
						tokenSeed: createCalendarFeedSeed(),
					})
					.returning();
			}
			if (!row) throw new TransactionAbort('calendar_subscription_failed');

			return {
				response: { status: 200, body: { subscription: responseFor(row) } },
				...(!existing || existing.revokedAt
					? {
							audit: {
								wgId: auth.wg.id,
								memberId: auth.member.memberId,
								eventType: existing ? 'calendar.feed_rotated' : 'calendar.feed_created',
								entityType: 'calendar_subscription',
								entityId: row.id,
								summary: `${member.name} hat den Kalender-Feed ${existing ? 'erneuert' : 'angelegt'}.`,
								metadata: { subscriptionId: row.id },
							} as Parameters<typeof recordAuditEvent>[0],
						}
					: {}),
			};
		},
	);
});

export const PATCH = withWgRoute('calendar subscription PATCH', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-rotate:${auth.wg.id}:${auth.member.memberId}`,
		auth,
		async (tx, member) => {
			const now = new Date();
			const [row] = await tx
				.update(calendarSubscriptions)
				.set({ tokenSeed: createCalendarFeedSeed(), updatedAt: now })
				.where(
					and(
						eq(calendarSubscriptions.wgId, auth.wg.id),
						eq(calendarSubscriptions.memberId, auth.member.memberId),
						isNull(calendarSubscriptions.revokedAt),
					),
				)
				.returning();
			if (!row)
				return { response: { status: 404, body: { error: 'calendar_subscription_not_found' } } };
			return {
				response: { status: 200, body: { subscription: responseFor(row) } },
				audit: {
					wgId: auth.wg.id,
					memberId: auth.member.memberId,
					eventType: 'calendar.feed_rotated',
					entityType: 'calendar_subscription',
					entityId: row.id,
					summary: `${member.name} hat den Kalender-Feed erneuert.`,
					metadata: { subscriptionId: row.id },
				},
			};
		},
	);
});

export const DELETE = withWgRoute('calendar subscription DELETE', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-revoke:${auth.wg.id}:${auth.member.memberId}`,
		auth,
		async (tx, member) => {
			const now = new Date();
			const [row] = await tx
				.update(calendarSubscriptions)
				.set({ revokedAt: now, updatedAt: now })
				.where(
					and(
						eq(calendarSubscriptions.wgId, auth.wg.id),
						eq(calendarSubscriptions.memberId, auth.member.memberId),
						isNull(calendarSubscriptions.revokedAt),
					),
				)
				.returning({ id: calendarSubscriptions.id });
			if (!row)
				return { response: { status: 404, body: { error: 'calendar_subscription_not_found' } } };
			return {
				response: { status: 200, body: { revoked: true } },
				audit: {
					wgId: auth.wg.id,
					memberId: auth.member.memberId,
					eventType: 'calendar.feed_revoked',
					entityType: 'calendar_subscription',
					entityId: row.id,
					summary: `${member.name} hat den Kalender-Feed widerrufen.`,
					metadata: { subscriptionId: row.id },
				},
			};
		},
	);
});
