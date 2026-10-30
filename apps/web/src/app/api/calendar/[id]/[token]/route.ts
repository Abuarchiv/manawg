import { and, asc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { calendarSubscriptions, wgEvents, wgMembers, wgs } from '@/core/db';
import { withTransaction } from '@/core/db/transaction';
import { isUuid } from '@/core/guards/api-auth';
import {
	notFound,
	rateLimitResponse,
	serverError,
	serviceUnavailable,
} from '@/core/http/api-errors';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, clientIpKey, wgReadLimiter } from '@/core/rate-limit';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import { MS_PER_DAY } from '@/core/utils/time';
import { type EventInput, expandRecurrence } from '@/features/events/events';
import { type CalendarFeedOccurrence, calendarFeedToIcs } from '@/features/events/ics';
import {
	isCalendarFeedToken,
	verifyCalendarFeedToken,
} from '@/features/events/server/calendar-subscription';
import {
	buildEventsWindowFilter,
	withEventWindowCandidates,
} from '@/features/events/server/event-reminder-window';

const FEED_HORIZON_DAYS = 365;
// Calendar apps mirror the feed: an occurrence that leaves the feed is deleted
// on the next sync, so recent history stays in instead of vanishing at midnight.
const FEED_HISTORY_DAYS = 90;
// The 455-day window holds up to 455 daily occurrences, more than the default expansion cap.
const FEED_MAX_EXPAND = 500;
const FEED_CALENDAR_NAME = 'ManaWG';

function eventToInput(row: typeof wgEvents.$inferSelect): EventInput {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt?.toISOString() ?? null,
		allDay: row.allDay,
		location: row.location,
		recurrence: row.recurrence,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function GET(
	req: NextRequest,
	ctx: RouteCtx<{ id: string; token: string }>,
): Promise<NextResponse> {
	const { id, token } = await ctx.params;
	if (!isUuid(id) || !isCalendarFeedToken(token)) return notFound('calendar_feed_not_found');

	const limit = rateLimitResponse(
		await checkRateLimit(wgReadLimiter, `calendar-feed:${clientIpKey(req)}`),
		'rate_limited',
	);
	if (limit) return limit;

	const now = Date.now();
	const from = startOfBerlinDay(new Date(now - FEED_HISTORY_DAYS * MS_PER_DAY));
	const to = new Date(startOfBerlinDay(new Date(now)).getTime() + FEED_HORIZON_DAYS * MS_PER_DAY);
	try {
		const feed = await withTransaction(async (tx) => {
			const [beforeLock] = await tx
				.select({ wgId: calendarSubscriptions.wgId, tokenSeed: calendarSubscriptions.tokenSeed })
				.from(calendarSubscriptions)
				.where(and(eq(calendarSubscriptions.id, id), isNull(calendarSubscriptions.revokedAt)))
				.limit(1);
			// Reject a wrong token before taking any lock, so an unauthenticated
			// caller holding only a feed id cannot make WG writes wait.
			if (!beforeLock || !verifyCalendarFeedToken(id, beforeLock.tokenSeed, token)) return null;
			// A share lock is enough to serialize with member deactivation and WG
			// deletion (both hold FOR UPDATE) without blocking ordinary inserts.
			const [wg] = await tx
				.select({ id: wgs.id, name: wgs.name })
				.from(wgs)
				.where(eq(wgs.id, beforeLock.wgId))
				.for('share');
			if (!wg) return null;

			const [subscription] = await tx
				.select({
					id: calendarSubscriptions.id,
					wgId: calendarSubscriptions.wgId,
					tokenSeed: calendarSubscriptions.tokenSeed,
				})
				.from(calendarSubscriptions)
				.innerJoin(wgMembers, eq(wgMembers.id, calendarSubscriptions.memberId))
				.where(
					and(
						eq(calendarSubscriptions.id, id),
						isNull(calendarSubscriptions.revokedAt),
						isNull(wgMembers.deactivatedAt),
						isNotNull(wgMembers.authUserId),
					),
				)
				.limit(1);
			if (!subscription || !verifyCalendarFeedToken(id, subscription.tokenSeed, token)) return null;
			// Same window as the events API: only rows that can produce an
			// occurrence in [from, to] (recurring roots have no age bound), paged
			// and capped instead of loading the WG's whole event history.
			const baseFilter = and(
				eq(wgEvents.wgId, subscription.wgId),
				buildEventsWindowFilter(from, to),
			);
			return withEventWindowCandidates(
				from,
				(cursor, pageLimit) => {
					const cursorFilter = cursor
						? or(
								gt(wgEvents.startsAt, cursor.startsAt),
								and(eq(wgEvents.startsAt, cursor.startsAt), gt(wgEvents.id, cursor.id)),
							)
						: undefined;
					return tx
						.select()
						.from(wgEvents)
						.where(cursorFilter ? and(baseFilter, cursorFilter) : baseFilter)
						.orderBy(asc(wgEvents.startsAt), asc(wgEvents.id))
						.limit(pageLimit);
				},
				() => 'window_too_large' as const,
				(rows) => ({ wgName: wg.name, rows }),
			);
		});
		if (!feed) return notFound('calendar_feed_not_found');
		if (feed === 'window_too_large') {
			return serviceUnavailable('events_window_too_large');
		}

		const occurrences: CalendarFeedOccurrence[] = feed.rows.flatMap((row) =>
			expandRecurrence(eventToInput(row), from, to, FEED_MAX_EXPAND),
		);
		// Several subscribed WGs must stay distinguishable in the calendar app.
		const body = calendarFeedToIcs(occurrences, `${FEED_CALENDAR_NAME} · ${feed.wgName}`);
		return new NextResponse(body, {
			headers: {
				'Cache-Control': 'no-store',
				'Content-Disposition': 'inline; filename="manawg-calendar.ics"',
				'Content-Type': 'text/calendar; charset=utf-8',
				'X-Content-Type-Options': 'nosniff',
			},
		});
	} catch (err) {
		logApiError('[calendar feed GET]', err);
		return serverError('db_error');
	}
}
