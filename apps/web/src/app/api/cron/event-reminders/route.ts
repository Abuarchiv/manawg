import { db, idempotencyResponses, wgEvents, wgs } from '@/core/db';
import { verifyCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	computeRecurrenceLookbackStart,
	computeTomorrowUtcWindow,
} from '@/features/events/event-reminder-window';
import { type EventInput, expandRecurrence } from '@/features/events/events';
import { and, eq, gte, lte } from 'drizzle-orm';
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
		const horizonStart = computeRecurrenceLookbackStart(now);

		const rows = await db
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
			.where(and(gte(wgEvents.startsAt, horizonStart), lte(wgEvents.startsAt, tomorrowEnd)));

		const due: Array<EventRow & { occurrenceStartsAt: string }> = [];
		for (const row of rows) {
			if (row.startsAt.getTime() >= horizonStart.getTime()) {
				const occurrences = expandRecurrence(toEventInput(row), tomorrowStart, tomorrowEnd);
				for (const occ of occurrences) {
					due.push({ ...row, occurrenceStartsAt: occ.startsAt });
				}
			}
		}

		if (due.length === 0) return NextResponse.json({ ok: true, sent: 0 });

		const pending: typeof due = [];
		for (const item of due) {
			if (await claimReminderDispatch(item, now)) pending.push(item);
		}

		if (pending.length === 0) return NextResponse.json({ ok: true, sent: 0 });

		const results = await Promise.allSettled(
			pending.map(async (item) => {
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
			}),
		);

		// Release claims for failed dispatches or zero-delivery sends so the
		// next run retries instead of silently dropping the reminder.
		const failedKeys = pending
			.filter((_, idx) => {
				const result = results[idx];
				if (result?.status === 'rejected') return true;
				return result?.status === 'fulfilled' && result.value.sent === 0;
			})
			.map((item) => reminderClaimKey(item));
		await Promise.all(failedKeys.map((key) => releaseReminderDispatchClaim(key)));

		return NextResponse.json({ ok: true, sent: pending.length - failedKeys.length });
	},
);
