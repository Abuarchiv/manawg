import { recordAuditEvent } from '@/core/audit';
import { calendarSubscriptions, db, idempotencyResponses } from '@/core/db';
import { type DbTransaction, TransactionAbort, withTransaction } from '@/core/db/transaction';
import { requireVerifiedMember, serverError, tooMany } from '@/core/errors';
import { claimReplaySlotWithRetry } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	RESPONSE_REPLAY_TTL_SECONDS,
	getCachedResponse,
	readIdempotencyKey,
} from '@/core/idempotency';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	calendarFeedUrl,
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
} from '@/features/events/calendar-subscription';
import { getAppUrl } from '@/shared/lib/app-url';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

type CalendarSubscriptionRow = typeof calendarSubscriptions.$inferSelect;
type CachedJsonResponse = { status: number; body: unknown };
type MutationResult = {
	response: CachedJsonResponse;
	audit?: Parameters<typeof recordAuditEvent>[0];
};

function cachedResponse(value: unknown): CachedJsonResponse | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		typeof row.status === 'number' &&
		Number.isInteger(row.status) &&
		row.status >= 200 &&
		row.status <= 599 &&
		'body' in row
	)
		return { status: row.status, body: row.body };
	// Older calendar replay rows stored the successful JSON body directly.
	if ('subscription' in row || row.revoked === true) return { status: 200, body: row };
	return null;
}

function replayResponse(response: CachedJsonResponse): NextResponse {
	return NextResponse.json(response.body, { status: response.status });
}

async function withCalendarMutation(
	req: NextRequest,
	scope: string,
	mutate: (tx: DbTransaction) => Promise<MutationResult>,
): Promise<NextResponse> {
	const key = readIdempotencyKey(req);
	if (key) {
		const cached = await getCachedResponse<unknown>(scope, key);
		if (cached) {
			const response = cachedResponse(cached);
			if (!response) throw new Error('idempotency_response_invalid');
			return replayResponse(response);
		}
		const claim = await claimReplaySlotWithRetry<unknown>(scope, key);
		if (!claim.won) {
			const response = cachedResponse(claim.cached);
			if (!response) throw new Error('idempotency_response_invalid');
			return replayResponse(response);
		}
	}

	let result:
		| { replayed: true; response: CachedJsonResponse }
		| { replayed: false; outcome: MutationResult };
	try {
		result = await withTransaction(async (tx) => {
			if (key) {
				const [slot] = await tx
					.select({
						body: idempotencyResponses.responseBody,
						expiresAt: idempotencyResponses.expiresAt,
					})
					.from(idempotencyResponses)
					.where(and(eq(idempotencyResponses.scope, scope), eq(idempotencyResponses.key, key)))
					.limit(1)
					.for('update');
				if (!slot) throw new TransactionAbort('idempotency_claim_missing');
				const completed = cachedResponse(slot.body);
				if (slot.expiresAt > new Date() && completed) {
					return { replayed: true as const, response: completed };
				}
				if (
					slot.expiresAt <= new Date() ||
					!slot.body ||
					typeof slot.body !== 'object' ||
					Array.isArray(slot.body) ||
					Object.keys(slot.body).length !== 1 ||
					(slot.body as Record<string, unknown>)._claimed !== true
				)
					throw new TransactionAbort('idempotency_claim_invalid');
			}
			const outcome = await mutate(tx);
			if (key) {
				const updated = await tx
					.update(idempotencyResponses)
					.set({
						responseBody: outcome.response,
						expiresAt: new Date(Date.now() + RESPONSE_REPLAY_TTL_SECONDS * 1000),
					})
					.where(
						and(
							eq(idempotencyResponses.scope, scope),
							eq(idempotencyResponses.key, key),
							gt(idempotencyResponses.expiresAt, new Date()),
							sql`${idempotencyResponses.responseBody} = '{"_claimed":true}'::jsonb`,
						),
					)
					.returning({ scope: idempotencyResponses.scope });
				if (updated.length !== 1) throw new TransactionAbort('idempotency_claim_missing');
			}
			return { replayed: false as const, outcome };
		});
	} catch (err) {
		if (err instanceof TransactionAbort) return serverError(err.code);
		throw err;
	}
	if (result.replayed) return replayResponse(result.response);
	if (result.outcome.audit) await recordAuditEvent(result.outcome.audit);
	return replayResponse(result.outcome.response);
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

async function requireCalendarMember(req: NextRequest, code: string) {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth;
	const denied = requireVerifiedMember(auth.member);
	if (denied) return { ok: false as const, response: denied };
	return auth;
}

export const GET = withWgRoute(
	'calendar subscription GET',
	async (req, { code }) => {
		const limit = await checkRateLimit(wgReadLimiter, `calendar-subscription:${clientIpKey(req)}`);
		if (!limit.success) return tooMany('rate_limited');
		const auth = await requireCalendarMember(req, code);
		if (!auth.ok) return auth.response;
		const row = await db.query.calendarSubscriptions.findFirst({
			where: and(
				eq(calendarSubscriptions.wgId, auth.wg.id),
				eq(calendarSubscriptions.memberId, auth.member.memberId),
				isNull(calendarSubscriptions.revokedAt),
			),
		});
		return NextResponse.json(
			{ subscription: row ? responseFor(row) : null },
			{ headers: { 'Cache-Control': 'private, no-store' } },
		);
	},
	{
		fixture: () =>
			NextResponse.json(
				{ subscription: null },
				{ headers: { 'Cache-Control': 'private, no-store' } },
			),
	},
);

export const POST = withWgRoute('calendar subscription POST', async (req, { code }) => {
	const auth = await requireCalendarMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-create:${auth.wg.id}:${auth.member.memberId}`,
		async (tx) => {
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
								summary: `${auth.member.name} hat den Kalender-Feed ${existing ? 'erneuert' : 'angelegt'}.`,
								metadata: { subscriptionId: row.id },
							} as Parameters<typeof recordAuditEvent>[0],
						}
					: {}),
			};
		},
	);
});

export const PATCH = withWgRoute('calendar subscription PATCH', async (req, { code }) => {
	const auth = await requireCalendarMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-rotate:${auth.wg.id}:${auth.member.memberId}`,
		async (tx) => {
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
					summary: `${auth.member.name} hat den Kalender-Feed erneuert.`,
					metadata: { subscriptionId: row.id },
				},
			};
		},
	);
});

export const DELETE = withWgRoute('calendar subscription DELETE', async (req, { code }) => {
	const auth = await requireCalendarMember(req, code);
	if (!auth.ok) return auth.response;
	const limit = await checkRateLimit(
		wgWriteLimiter,
		`calendar-subscription:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limit.success) return tooMany('rate_limited');

	return withCalendarMutation(
		req,
		`calendar-subscription-revoke:${auth.wg.id}:${auth.member.memberId}`,
		async (tx) => {
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
					summary: `${auth.member.name} hat den Kalender-Feed widerrufen.`,
					metadata: { subscriptionId: row.id },
				},
			};
		},
	);
});
