import { db, idempotencyResponses, wgEvents, wgs } from '@/core/db';
import { verifyCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	EVENT_REMINDER_BUDGET,
	collectReminderOccurrences,
	processReminderBatches,
	startsInReminderWindow,
} from '@/features/events/event-reminder-dispatch';
import {
	buildEventsWindowFilter,
	computeTomorrowUtcWindow,
	withEventWindowCandidates,
} from '@/features/events/event-reminder-window';
import { type EventInput, expandRecurrence } from '@/features/events/events';
import { and, asc, eq, gt, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

const REMINDER_CLAIM_SCOPE = 'event-reminders';
const REMINDER_CLAIM_TTL_MS = 32 * MS_PER_DAY;

interface EventRow {
	id: string;
	title: string;
	description: string | null;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
	wgId: string;
	wgName: string;
	shareCode: string;
}

function toEventInput(row: EventRow): EventInput {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt ? row.endsAt.toISOString() : null,
		allDay: row.allDay,
		location: row.location,
		recurrence: row.recurrence,
	};
}

function reminderClaimKey(item: EventRow & { occurrenceStartsAt: string }): string {
	return `${item.id}:${item.occurrenceStartsAt}`;
}

async function claimReminderDispatch(
	item: EventRow & { occurrenceStartsAt: string },
	now: Date,
): Promise<boolean> {
	const key = reminderClaimKey(item);
	const inserted = await db
		.insert(idempotencyResponses)
		.values({
			scope: REMINDER_CLAIM_SCOPE,
			key,
			responseBody: { eventId: item.id, occurrenceStartsAt: item.occurrenceStartsAt },
			expiresAt: new Date(now.getTime() + REMINDER_CLAIM_TTL_MS),
		})
		.onConflictDoNothing()
		.returning({ key: idempotencyResponses.key });

	return inserted.length > 0;
}

/** Free the claim so a failed dispatch retries on the next cron run. */
async function releaseReminderDispatchClaim(key: string): Promise<void> {
	await db
		.delete(idempotencyResponses)
		.where(
			and(eq(idempotencyResponses.scope, REMINDER_CLAIM_SCOPE), eq(idempotencyResponses.key, key)),
		);
}

export const GET = withCronLogging(
	'event-reminders',
	async (req: NextRequest): Promise<NextResponse> => {
		const secret = process.env.CRON_SECRET;
		if (!secret) return new NextResponse('cron_secret_missing', { status: 503 });
		if (!verifyCronSecret(req.headers.get('authorization'), secret)) {
			return new NextResponse('unauthorized', { status: 401 });
		}

		const now = new Date();
		const { start: tomorrowStart, end: tomorrowEnd } = computeTomorrowUtcWindow(now);

		return withEventWindowCandidates(
			tomorrowStart,
			async (cursor, pageLimit) => {
				const cursorFilter = cursor
					? or(
							gt(wgEvents.startsAt, cursor.startsAt),
							and(eq(wgEvents.startsAt, cursor.startsAt), gt(wgEvents.id, cursor.id)),
						)
					: undefined;
				const windowFilter = buildEventsWindowFilter(tomorrowStart, tomorrowEnd);
				const where = cursorFilter ? and(windowFilter, cursorFilter) : windowFilter;
				return db
					.select({
						id: wgEvents.id,
						title: wgEvents.title,
						description: wgEvents.description,
						startsAt: wgEvents.startsAt,
						endsAt: wgEvents.endsAt,
						allDay: wgEvents.allDay,
						location: wgEvents.location,
						recurrence: wgEvents.recurrence,
						wgId: wgs.id,
						wgName: wgs.name,
						shareCode: wgs.shareCode,
					})
					.from(wgEvents)
					.innerJoin(wgs, eq(wgEvents.wgId, wgs.id))
					.where(where)
					.orderBy(asc(wgEvents.startsAt), asc(wgEvents.id))
					.limit(pageLimit);
			},
			() => NextResponse.json({ error: 'events_window_too_large' }, { status: 503 }),
			async (candidateRows) => {
				const due = collectReminderOccurrences(candidateRows, (row) =>
					expandRecurrence(toEventInput(row), tomorrowStart, tomorrowEnd)
						.filter((occ) => startsInReminderWindow(occ, tomorrowStart, tomorrowEnd))
						.map((occ) => ({ ...row, occurrenceStartsAt: occ.startsAt })),
				);
				if (due === null) {
					return NextResponse.json({ error: 'events_window_too_large' }, { status: 503 });
				}

				if (due.length === 0) return NextResponse.json({ ok: true, sent: 0 });

				const sent = await processReminderBatches(
					due,
					(item) => claimReminderDispatch(item, now),
					async (item) => {
						try {
							return await dispatchNotification({
								wg: { id: item.wgId, name: item.wgName, shareCode: item.shareCode },
								event: 'event.upcoming',
								payload: {
									eventId: item.id,
									title: item.title,
									startsAt: item.occurrenceStartsAt,
								},
							});
						} catch (err) {
							console.warn('[event-reminders] notification dispatch failed');
							return { sent: 0, failures: [err] };
						}
					},
					(item) => releaseReminderDispatchClaim(reminderClaimKey(item)),
				);

				return NextResponse.json({ ok: true, sent });
			},
			EVENT_REMINDER_BUDGET,
		);
	},
);
