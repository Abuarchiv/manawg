import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import {
	choreCompletions,
	chores,
	db,
	idempotencyResponses,
	memberAbsences,
	pushSubscriptions,
	wgMembers,
	wgs,
} from '@/core/db';
import { requireCronSecret } from '@/core/infra/cron-auth';
import { captureException, withCronLogging } from '@/core/infra/observability';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { endOfBerlinDay, prevBerlinDayStart, startOfBerlinDay } from '@/core/utils/berlin-day';
import { DISPATCH_BATCH_SIZE } from '@/features/events/event-reminder-dispatch';

// Minimum gap between reminders for one chore. The cron runs daily at 08:00; 18 h keeps a
// manual replay, retry or clock drift from firing twice on the same day without depending on
// calendar-day (TZ/DST) maths.
const REMINDER_THROTTLE_MS = 18 * 60 * 60 * 1000;
const REMINDER_CLAIM_SCOPE = 'chore-reminders';
// Per-run cap; throttled chores are excluded in SQL, so a larger backlog is
// drained by the following runs instead of being loaded in one go.
const REMINDER_CANDIDATE_LIMIT = 500;
const UNASSIGNED_CANDIDATE_LIMIT = 100;
// An assigned chore is reminded on its due day and the day after, then the push stays silent;
// it remains in "For you" and in the plan. This also bounds the candidate query.

interface DueChore {
	id: string;
	title: string;
	nextDueAt: Date;
	assignedMemberId: string | null;
	wgId: string;
	wgName: string;
	shareCode: string;
}

/** The chores of one member (or the unassigned ones of one WG) that are reminded in one push. */
interface ReminderBundle {
	wg: { id: string; name: string; shareCode: string };
	assignedMemberId: string | null;
	chores: DueChore[];
}

function bundleByRecipient(chores: DueChore[]): ReminderBundle[] {
	const bundles = new Map<string, ReminderBundle>();
	for (const chore of chores) {
		const key = `${chore.wgId}:${chore.assignedMemberId ?? ''}`;
		const bundle = bundles.get(key) ?? {
			wg: { id: chore.wgId, name: chore.wgName, shareCode: chore.shareCode },
			assignedMemberId: chore.assignedMemberId,
			chores: [],
		};
		bundle.chores.push(chore);
		bundles.set(key, bundle);
	}
	return [...bundles.values()];
}

function reminderClaimKey(choreId: string, startOfDay: Date): string {
	return `${choreId}:${startOfDay.toISOString()}`;
}

async function claimReminderDispatch(
	choreId: string,
	startOfDay: Date,
	now: Date,
): Promise<string | null> {
	const key = reminderClaimKey(choreId, startOfDay);
	const inserted = await db
		.insert(idempotencyResponses)
		.values({
			scope: REMINDER_CLAIM_SCOPE,
			key,
			responseBody: { choreId, reminderDay: startOfDay.toISOString() },
			expiresAt: new Date(now.getTime() + REMINDER_THROTTLE_MS),
		})
		.onConflictDoNothing()
		.returning({ key: idempotencyResponses.key });

	return inserted.length > 0 ? key : null;
}

async function releaseReminderDispatchClaim(key: string): Promise<void> {
	await db
		.delete(idempotencyResponses)
		.where(
			and(eq(idempotencyResponses.scope, REMINDER_CLAIM_SCOPE), eq(idempotencyResponses.key, key)),
		);
}

async function dispatchBundle(
	bundle: ReminderBundle,
	chores: DueChore[],
): Promise<{ sent: number; failures: unknown[] }> {
	const [first] = chores;
	if (!first) return { sent: 0, failures: [] };
	const unassigned = bundle.assignedMemberId ? {} : { unassigned: true };
	try {
		return await dispatchNotification({
			wg: bundle.wg,
			event: 'chore.due',
			payload:
				chores.length === 1
					? {
							...unassigned,
							title: first.title,
							choreId: first.id,
							nextDueAt: first.nextDueAt.toISOString(),
						}
					: { ...unassigned, titles: chores.map((chore) => chore.title) },
			...(bundle.assignedMemberId ? { targetMemberIds: [bundle.assignedMemberId] } : {}),
			// A bundle replaces the one still on the device and alerts again.
			...(chores.length > 1
				? { tag: `chores:${bundle.wg.id}${bundle.assignedMemberId ? '' : ':unassigned'}` }
				: {}),
		});
	} catch (err) {
		captureException(err, { cronJob: 'chore-reminders' });
		return { sent: 0, failures: [err] };
	}
}

export const GET = withCronLogging(
	'chore-reminders',
	async (req: NextRequest): Promise<NextResponse> => {
		const denied = requireCronSecret(req);
		if (denied) return denied;

		const now = new Date();
		// "Today" by the Berlin wall clock, not the UTC day the server runs in —
		// otherwise chores due "today" and completions since midnight are judged
		// against a day that starts 1-2 hours late for every member.
		const startOfDay = startOfBerlinDay(now);
		const endOfDay = endOfBerlinDay(now);
		const throttleCutoff = new Date(now.getTime() - REMINDER_THROTTLE_MS);
		const lookbackStart = prevBerlinDayStart(startOfDay);

		const due = await db
			.select({
				id: chores.id,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignedMemberId: chores.assignedMemberId,
				wgId: wgs.id,
				wgName: wgs.name,
				shareCode: wgs.shareCode,
			})
			.from(chores)
			.innerJoin(wgs, eq(chores.wgId, wgs.id))
			.innerJoin(wgMembers, eq(chores.assignedMemberId, wgMembers.id))
			.where(
				and(
					lte(chores.nextDueAt, endOfDay),
					// An absence skips the chore on every run while it lasts, so the lookback
					// also reaches back to the end of the assignee's last absence.
					or(
						gte(chores.nextDueAt, lookbackStart),
						sql`exists (select 1 from ${memberAbsences} a where a.member_id = ${chores.assignedMemberId} and a.start_date <= ${endOfDay} and a.end_date >= ${lookbackStart})`,
					),
					isNotNull(chores.assignedMemberId),
					or(isNull(chores.lastReminderAt), lte(chores.lastReminderAt, throttleCutoff)),
					// Moved-out assignees are skipped entirely — the rotation
					// handles reassignment, this only guards stale reminders.
					isNull(wgMembers.deactivatedAt),
					// Only chores that can actually be delivered are candidates: an
					// assignee without push (opt-out, chores muted, no subscription)
					// never gets lastReminderAt stamped and would otherwise occupy
					// the NULLS FIRST front of the capped window forever. Mirrors
					// the eligibility checks in dispatchNotification.
					eq(wgMembers.pushOptIn, true),
					eq(wgMembers.notifyChores, true),
					sql`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.memberId} = ${wgMembers.id})`,
					// Absent assignees keep the chore (the rotation only moves it on
					// completion) but get no push; the plan flags it for housemates.
					sql`not exists (select 1 from ${memberAbsences} where ${memberAbsences.memberId} = ${chores.assignedMemberId} and ${memberAbsences.startDate} <= ${endOfDay} and ${memberAbsences.endDate} >= ${startOfDay})`,
				),
			)
			// Rotate the capped window across daily runs: never-reminded chores
			// first, then the ones reminded longest ago, so a backlog above the
			// cap cannot keep the same oldest rows in front forever.
			.orderBy(sql`${chores.lastReminderAt} asc nulls first`, asc(chores.nextDueAt), asc(chores.id))
			.limit(REMINDER_CANDIDATE_LIMIT);

		// Nobody is answerable for these, so without a reminder they would stay overdue.
		// No lookback: the chore will not rotate on its own, so it keeps its one announcement
		// per throttle window until somebody picks it up.
		const unassigned = await db
			.select({
				id: chores.id,
				title: chores.title,
				nextDueAt: chores.nextDueAt,
				assignedMemberId: chores.assignedMemberId,
				wgId: wgs.id,
				wgName: wgs.name,
				shareCode: wgs.shareCode,
			})
			.from(chores)
			.innerJoin(wgs, eq(chores.wgId, wgs.id))
			.where(
				and(
					lte(chores.nextDueAt, endOfDay),
					isNull(chores.assignedMemberId),
					or(isNull(chores.lastReminderAt), lte(chores.lastReminderAt, throttleCutoff)),
					// Only chores somebody can be told about, as in the assigned query; otherwise
					// undeliverable ones keep the front of the capped window forever.
					sql`exists (select 1 from ${wgMembers} wm where wm.wg_id = ${chores.wgId}
						and wm.deactivated_at is null and wm.push_opt_in and wm.notify_chores
						and exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.memberId} = wm.id))`,
				),
			)
			.orderBy(sql`${chores.lastReminderAt} asc nulls first`, asc(chores.nextDueAt), asc(chores.id))
			.limit(UNASSIGNED_CANDIDATE_LIMIT);
		due.push(...unassigned);

		if (due.length === 0) return NextResponse.json({ ok: true, sent: 0 });

		const completions = await db
			.select({ choreId: choreCompletions.choreId })
			.from(choreCompletions)
			.where(
				and(
					inArray(
						choreCompletions.choreId,
						due.map((item) => item.id),
					),
					gte(choreCompletions.completedAt, startOfDay),
				),
			);
		const completedToday = new Set(completions.map((item) => item.choreId));
		const pending = due.filter((item) => !completedToday.has(item.id));

		// One push per recipient and day: a member's due chores (or a WG's unassigned ones) are
		// bundled. Claims stay per chore, so a replay or retry never reminds a chore twice.
		// Bundles are claimed and dispatched in fixed-size batches so a large backlog never
		// opens hundreds of concurrent DB claims and push requests at once.
		const bundles = bundleByRecipient(pending);
		const sentChoreIds: string[] = [];
		const failedClaimKeys: string[] = [];
		let failed = 0;
		for (let index = 0; index < bundles.length; index += DISPATCH_BATCH_SIZE) {
			await Promise.all(
				bundles.slice(index, index + DISPATCH_BATCH_SIZE).map(async (bundle) => {
					const claims = await Promise.all(
						bundle.chores.map(async (chore) => ({
							chore,
							claimKey: await claimReminderDispatch(chore.id, startOfDay, now),
						})),
					);
					const claimed = claims.flatMap(({ chore, claimKey }) =>
						claimKey ? [{ chore, claimKey }] : [],
					);
					if (claimed.length === 0) return;
					const dispatched = await dispatchBundle(
						bundle,
						claimed.map(({ chore }) => chore),
					);
					// Only stamp chores whose dispatch actually delivered at least one
					// push — a fulfilled promise with sent: 0 (e.g. no VAPID keys) would
					// otherwise silently swallow the reminder until the throttle window
					// passes. Failed pushes release their claim and retry next run.
					if (dispatched.sent > 0) {
						sentChoreIds.push(...claimed.map(({ chore }) => chore.id));
					} else {
						failedClaimKeys.push(...claimed.map(({ claimKey }) => claimKey));
						if (dispatched.failures.length > 0) failed += 1;
					}
				}),
			);
		}

		await Promise.all(failedClaimKeys.map((key) => releaseReminderDispatchClaim(key)));
		if (sentChoreIds.length > 0) {
			await db.update(chores).set({ lastReminderAt: now }).where(inArray(chores.id, sentChoreIds));
		}

		// A 503 keeps a failed dispatch visible in the cron log instead of reporting success.
		return NextResponse.json(
			{ ok: failed === 0, sent: sentChoreIds.length, ...(failed > 0 ? { failed } : {}) },
			{ status: failed === 0 ? 200 : 503 },
		);
	},
);
