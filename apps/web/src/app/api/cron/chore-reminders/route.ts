import { endOfBerlinDay, startOfBerlinDay } from '@/lib/berlin-day';
import { verifyCronSecret } from '@/lib/cron-auth';
import * as dbSchema from '@/lib/db';
import { choreCompletions, chores, db, wgMembers, wgs } from '@/lib/db';
import { dispatchNotification } from '@/lib/notification-dispatch';
import { withCronLogging } from '@/lib/observability';
import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

// Minimum gap between reminder dispatches for the same chore. The cron runs
// daily at 08:00, so 18h guarantees we never re-fire within the same day even
// if the cron is re-invoked (manual replay, retry, drift). Bumped instead of
// "calendar day" to remain robust against TZ/DST/replay edge cases.
const REMINDER_THROTTLE_MS = 18 * 60 * 60 * 1000;
const REMINDER_CLAIM_SCOPE = 'chore-reminders';
const localReminderClaims = new Set<string>();

function getReminderClaimTable(): typeof dbSchema.idempotencyResponses | null {
	return 'idempotencyResponses' in dbSchema ? dbSchema.idempotencyResponses : null;
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
	const idempotencyResponses = getReminderClaimTable();
	if (!idempotencyResponses || typeof (db as { insert?: unknown }).insert !== 'function') {
		if (localReminderClaims.has(key)) return null;
		localReminderClaims.add(key);
		return key;
	}

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
	const idempotencyResponses = getReminderClaimTable();
	if (!idempotencyResponses || typeof (db as { delete?: unknown }).delete !== 'function') {
		localReminderClaims.delete(key);
		return;
	}

	await db
		.delete(idempotencyResponses)
		.where(
			and(eq(idempotencyResponses.scope, REMINDER_CLAIM_SCOPE), eq(idempotencyResponses.key, key)),
		);
}

export const GET = withCronLogging(
	'chore-reminders',
	async (req: NextRequest): Promise<NextResponse> => {
		const secret = process.env.CRON_SECRET;
		// Fail CLOSED: without CRON_SECRET set, the endpoint is world-callable —
		// anyone can enumerate WGs and trigger N notifications. Previously the
		// `secret && ...` short-circuit silently skipped auth when the env var
		// was missing.
		if (!secret) {
			return new NextResponse('cron_secret_missing', { status: 503 });
		}
		if (!verifyCronSecret(req.headers.get('authorization'), secret)) {
			return new NextResponse('unauthorized', { status: 401 });
		}

		const now = new Date();
		// "Today" by the Berlin wall clock, not the UTC day the server runs in —
		// otherwise chores due "today" and completions since midnight are judged
		// against a day that starts 1-2 hours late for every member.
		const startOfDay = startOfBerlinDay(now);
		const endOfDay = endOfBerlinDay(now);
		const throttleCutoff = new Date(now.getTime() - REMINDER_THROTTLE_MS);

		const due = await db
			.select({
				id: chores.id,
				title: chores.title,
				assignedMemberId: chores.assignedMemberId,
				lastReminderAt: chores.lastReminderAt,
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
					isNotNull(chores.assignedMemberId),
					// Moved-out assignees are skipped entirely — the rotation
					// handles reassignment, this only guards stale reminders.
					isNull(wgMembers.deactivatedAt),
				),
			);

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
		const pending = due.filter((item): item is typeof item & { assignedMemberId: string } => {
			if (!item.assignedMemberId) return false;
			if (completedToday.has(item.id)) return false;
			// Throttle: skip if we already pinged the assignee within the window.
			// `lastReminderAt` is null for chores that have never been reminded —
			// those always pass through.
			if (item.lastReminderAt && item.lastReminderAt > throttleCutoff) return false;
			return true;
		});

		const claimed: Array<(typeof pending)[number] & { reminderClaimKey: string }> = [];
		for (const item of pending) {
			const claimKey = await claimReminderDispatch(item.id, startOfDay, now);
			if (claimKey) claimed.push({ ...item, reminderClaimKey: claimKey });
		}

		const results = await Promise.allSettled(
			claimed.map((item) =>
				dispatchNotification({
					wg: { id: item.wgId, name: item.wgName, shareCode: item.shareCode },
					event: 'chore.due',
					payload: { title: item.title, choreId: item.id },
					targetMemberIds: [item.assignedMemberId],
				}),
			),
		);

		// Only stamp chores whose dispatch actually delivered at least one
		// push — a fulfilled promise with sent: 0 (e.g. no VAPID keys) would
		// otherwise silently swallow the reminder until the throttle window
		// passes. Failed pushes release their claim and retry next run.
		const delivered = claimed
			.map((item, idx) => {
				const result = results[idx];
				if (result?.status !== 'fulfilled') return null;
				return { item, sent: result.value.sent };
			})
			.filter((entry): entry is { item: (typeof claimed)[number]; sent: number } => entry !== null);
		const sentChoreIds = delivered.filter((entry) => entry.sent > 0).map((entry) => entry.item.id);
		const failedClaimKeys = [
			...claimed
				.filter((_, idx) => results[idx]?.status === 'rejected')
				.map((item) => item.reminderClaimKey),
			...delivered.filter((entry) => entry.sent === 0).map((entry) => entry.item.reminderClaimKey),
		];
		await Promise.all(failedClaimKeys.map((key) => releaseReminderDispatchClaim(key)));
		if (sentChoreIds.length > 0) {
			await db.update(chores).set({ lastReminderAt: now }).where(inArray(chores.id, sentChoreIds));
		}

		return NextResponse.json({ ok: true, sent: sentChoreIds.length });
	},
);
