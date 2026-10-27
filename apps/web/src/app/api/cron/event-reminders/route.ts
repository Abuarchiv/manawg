import { db, idempotencyResponses, wgEvents, wgMembers, wgs } from '@/core/db';
import { requireCronSecret } from '@/core/infra/cron-auth';
import { withCronLogging } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import { MS_PER_DAY } from '@/core/utils/time';
import {
	type EventReminderCopy,
	processReminderBatches,
	reminderCopyForOccurrence,
} from '@/features/events/event-reminder-dispatch';
import { type EventInput, expandRecurrence } from '@/features/events/events';
import {
	buildEventsWindowFilter,
	computeTomorrowUtcWindow,
	forEachEventWindowPage,
} from '@/features/events/server/event-reminder-window';
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

const REMINDER_CLAIM_SCOPE = 'event-reminders';
const REMINDER_CLAIM_TTL_MS = 32 * MS_PER_DAY;
const REMINDER_CLAIM_LEASE_MS = 60 * 60 * 1000;
// Stops starting new send batches after this; the rest waits for the next run.
const REMINDER_TIME_BUDGET_MS = 45_000;

export const maxDuration = 60;

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

type ReminderDelivery = EventRow & {
	occurrenceStartsAt: string;
	occurrenceEndsAt: string | null;
	memberId: string;
	reminderCopy: EventReminderCopy;
};

function reminderClaimKey(item: ReminderDelivery): string {
	return `${item.id}:${item.occurrenceStartsAt}:${item.memberId}`;
}

async function claimReminderDispatch(item: ReminderDelivery, now: Date): Promise<boolean> {
	const key = reminderClaimKey(item);
	const responseBody = {
		eventId: item.id,
		occurrenceStartsAt: item.occurrenceStartsAt,
		occurrenceEndsAt: item.occurrenceEndsAt,
		memberId: item.memberId,
	};
	const inserted = await db
		.insert(idempotencyResponses)
		.values({
			scope: REMINDER_CLAIM_SCOPE,
			key,
			responseBody,
			expiresAt: new Date(now.getTime() + REMINDER_CLAIM_LEASE_MS),
		})
		.onConflictDoUpdate({
			target: [idempotencyResponses.scope, idempotencyResponses.key],
			set: { responseBody, expiresAt: new Date(now.getTime() + REMINDER_CLAIM_LEASE_MS) },
			where: lte(idempotencyResponses.expiresAt, now),
		})
		.returning({ key: idempotencyResponses.key });

	return inserted.length > 0;
}

async function keepReminderDispatchClaim(item: ReminderDelivery, now: Date): Promise<void> {
	const occurrenceEndMs = Date.parse(item.occurrenceEndsAt ?? item.occurrenceStartsAt);
	const expiresAt = new Date(
		Math.max(now.getTime(), Number.isFinite(occurrenceEndMs) ? occurrenceEndMs : now.getTime()) +
			REMINDER_CLAIM_TTL_MS,
	);
	await db
		.update(idempotencyResponses)
		.set({ expiresAt })
		.where(
			and(
				eq(idempotencyResponses.scope, REMINDER_CLAIM_SCOPE),
				eq(idempotencyResponses.key, reminderClaimKey(item)),
			),
		);
}

/** Free the claim so a failed dispatch retries on the next cron run. */
async function releaseReminderDispatchClaim(item: ReminderDelivery): Promise<void> {
	await db
		.delete(idempotencyResponses)
		.where(
			and(
				eq(idempotencyResponses.scope, REMINDER_CLAIM_SCOPE),
				eq(idempotencyResponses.key, reminderClaimKey(item)),
			),
		);
}

export const GET = withCronLogging(
	'event-reminders',
	async (req: NextRequest): Promise<NextResponse> => {
		const denied = requireCronSecret(req);
		if (denied) return denied;

		const now = new Date();
		const todayStart = startOfBerlinDay(now);
		const { start: tomorrowStart, end: tomorrowEnd } = computeTomorrowUtcWindow(now);

		const deadline = Date.now() + REMINDER_TIME_BUDGET_MS;
		const timeUp = () => Date.now() >= deadline;
		let sent = 0;
		let failed = 0;

		const complete = await forEachEventWindowPage(
			todayStart,
			async (cursor, pageLimit) => {
				const cursorFilter = cursor
					? or(
							gt(wgEvents.startsAt, cursor.startsAt),
							and(eq(wgEvents.startsAt, cursor.startsAt), gt(wgEvents.id, cursor.id)),
						)
					: undefined;
				const windowFilter = buildEventsWindowFilter(todayStart, tomorrowEnd);
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
			async (rows) => {
				const occurrences = rows.flatMap((row) =>
					expandRecurrence(toEventInput(row), todayStart, tomorrowEnd).flatMap((occ) => {
						const reminderCopy = reminderCopyForOccurrence(
							occ,
							now,
							todayStart,
							tomorrowStart,
							tomorrowEnd,
						);
						return reminderCopy
							? [
									{
										...row,
										occurrenceStartsAt: occ.startsAt,
										occurrenceEndsAt: occ.endsAt,
										reminderCopy,
									},
								]
							: [];
					}),
				);
				if (occurrences.length === 0) return !timeUp();

				const wgIds = [...new Set(occurrences.map((occurrence) => occurrence.wgId))];
				const members = await db
					.select({ id: wgMembers.id, wgId: wgMembers.wgId })
					.from(wgMembers)
					.where(and(inArray(wgMembers.wgId, wgIds), isNull(wgMembers.deactivatedAt)));
				const membersByWg = new Map<string, string[]>();
				for (const member of members) {
					const memberIds = membersByWg.get(member.wgId) ?? [];
					memberIds.push(member.id);
					membersByWg.set(member.wgId, memberIds);
				}

				const deliveries = occurrences.flatMap((occurrence) =>
					(membersByWg.get(occurrence.wgId) ?? []).map((memberId) => ({
						...occurrence,
						memberId,
					})),
				);

				// Retries while the occurrence is current; recovering after it ends would need durable state.
				const result = await processReminderBatches(
					deliveries,
					(item) => claimReminderDispatch(item, now),
					async (item) => {
						try {
							// A partial retry may repeat a successful device for this member.
							// Per-subscription claims would remove this duplication, if it ever matters.
							const result = await dispatchNotification({
								wg: { id: item.wgId, name: item.wgName, shareCode: item.shareCode },
								event: item.reminderCopy === 'today' ? 'event.today' : 'event.upcoming',
								targetMemberIds: [item.memberId],
								payload: {
									eventId: item.id,
									title: item.title,
									startsAt: item.occurrenceStartsAt,
									allDay: item.allDay,
									ongoing:
										item.reminderCopy === 'today' &&
										!item.allDay &&
										Date.parse(item.occurrenceStartsAt) < now.getTime(),
								},
							});
							if (result.sent > 0 && result.failures.length === 0) {
								await keepReminderDispatchClaim(item, now);
							}
							return result;
						} catch (err) {
							console.warn('[event-reminders] notification dispatch failed');
							return { sent: 0, failures: [err] };
						}
					},
					(item) => releaseReminderDispatchClaim(item),
					timeUp,
				);
				sent += result.sent;
				failed += result.failed;
				return !result.stopped && !timeUp();
			},
		);

		// The cron runs once a day, so a cut-off run loses the rest of tomorrow's reminders;
		// a 503 keeps that visible in the cron log instead of reporting success.
		if (!complete) {
			console.error('[event-reminders] time budget reached, remaining reminders were not sent');
		}
		const ok = failed === 0 && complete;
		return NextResponse.json(
			{ ok, sent, failed, ...(complete ? {} : { complete: false }) },
			{ status: ok ? 200 : 503 },
		);
	},
);
