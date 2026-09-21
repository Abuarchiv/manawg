import { recordAuditEvent } from '@/core/audit';
import { calendarSubscriptions, db } from '@/core/db';
import { notFound, requireVerifiedMember, serverError, tooMany } from '@/core/errors';
import { withIdempotentJsonResponse } from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, clientIpKey, wgReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import {
	calendarFeedUrl,
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
} from '@/features/events/calendar-subscription';
import { getAppUrl } from '@/shared/lib/app-url';
import { and, eq, isNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

type CalendarSubscriptionRow = typeof calendarSubscriptions.$inferSelect;

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

	return withIdempotentJsonResponse(
		req,
		`calendar-subscription-create:${auth.wg.id}:${auth.member.memberId}`,
		async () => {
			const existing = await db.query.calendarSubscriptions.findFirst({
				where: and(
					eq(calendarSubscriptions.wgId, auth.wg.id),
					eq(calendarSubscriptions.memberId, auth.member.memberId),
				),
			});
			const now = new Date();
			let row: CalendarSubscriptionRow | undefined;
			if (existing?.revokedAt) {
				[row] = await db
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
				[row] = await db
					.insert(calendarSubscriptions)
					.values({
						id,
						wgId: auth.wg.id,
						memberId: auth.member.memberId,
						tokenSeed: createCalendarFeedSeed(),
					})
					.returning();
			}
			if (!row) return serverError('calendar_subscription_failed');

			if (!existing || existing.revokedAt) {
				await recordAuditEvent({
					wgId: auth.wg.id,
					memberId: auth.member.memberId,
					eventType: existing ? 'calendar.feed_rotated' : 'calendar.feed_created',
					entityType: 'calendar_subscription',
					entityId: row.id,
					summary: `${auth.member.name} hat den Kalender-Feed ${existing ? 'erneuert' : 'angelegt'}.`,
					metadata: { subscriptionId: row.id },
				});
			}

			return NextResponse.json({ subscription: responseFor(row) });
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

	return withIdempotentJsonResponse(
		req,
		`calendar-subscription-rotate:${auth.wg.id}:${auth.member.memberId}`,
		async () => {
			const now = new Date();
			const [row] = await db
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
			if (!row) return notFound('calendar_subscription_not_found');
			await recordAuditEvent({
				wgId: auth.wg.id,
				memberId: auth.member.memberId,
				eventType: 'calendar.feed_rotated',
				entityType: 'calendar_subscription',
				entityId: row.id,
				summary: `${auth.member.name} hat den Kalender-Feed erneuert.`,
				metadata: { subscriptionId: row.id },
			});
			return NextResponse.json({ subscription: responseFor(row) });
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

	return withIdempotentJsonResponse(
		req,
		`calendar-subscription-revoke:${auth.wg.id}:${auth.member.memberId}`,
		async () => {
			const now = new Date();
			const [row] = await db
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
			if (!row) return notFound('calendar_subscription_not_found');
			await recordAuditEvent({
				wgId: auth.wg.id,
				memberId: auth.member.memberId,
				eventType: 'calendar.feed_revoked',
				entityType: 'calendar_subscription',
				entityId: row.id,
				summary: `${auth.member.name} hat den Kalender-Feed widerrufen.`,
				metadata: { subscriptionId: row.id },
			});
			return NextResponse.json({ revoked: true });
		},
	);
});
