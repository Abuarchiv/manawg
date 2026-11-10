import 'server-only';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { auditValues } from '@/core/audit-values';
import { announcements, auditEvents, choreCompletions, chores, withTransaction } from '@/core/db';
import { lockActiveMember } from '@/core/db/member-departure';
import { choreSwapSourcePath } from '@/features/chores/server/resolve-swap-request';

/**
 * A completion can be taken back for this long after the chore last changed on the server. The
 * clock is the chore's own `updatedAt`, not the client's tap time, which may be hours old or off.
 */
const UNDO_WINDOW_MS = 2 * 60_000;

export interface UndoCompletionInput {
	completionId: string;
	/** The chore as it was before the completion, as `complete` returned it. */
	previous: { nextDueAt: Date; assignedMemberId: string | null; anchorAt: Date };
	/** The chore as the completion left it; the undo only applies while it still looks like this. */
	expected: { nextDueAt: Date; assignedMemberId: string | null };
}

export type UndoCompletionResult =
	| { ok: true; chore: typeof chores.$inferSelect }
	| {
			ok: false;
			error:
				| 'chore_not_found'
				| 'not_owner'
				| 'completion_not_found'
				| 'undo_expired'
				| 'not_latest_completion'
				| 'chore_changed';
	  };

/**
 * Takes back the caller's own latest completion: restores the date, assignee and anchor from
 * before it, reopens the swap request the completion closed, deletes the completion row and
 * writes the compensating audit event, all in one transaction. Locks are taken member first, then
 * the chore row (the order of completing and of moving out), so a second undo or a concurrent
 * completion waits and then finds the state changed.
 */
export function undoChoreCompletion(
	wgId: string,
	choreId: string,
	actor: { memberId: string; name: string },
	input: UndoCompletionInput,
	now = Date.now(),
): Promise<UndoCompletionResult> {
	return withTransaction(async (tx): Promise<UndoCompletionResult> => {
		// The previous assignee may have moved out since; the chore then stays unassigned.
		const assignee =
			input.previous.assignedMemberId &&
			(await lockActiveMember(tx, wgId, input.previous.assignedMemberId))
				? input.previous.assignedMemberId
				: null;
		const [chore] = await tx
			.select()
			.from(chores)
			.where(and(eq(chores.id, choreId), eq(chores.wgId, wgId)))
			.limit(1)
			.for('update');
		if (!chore) return { ok: false, error: 'chore_not_found' };

		const [completion] = await tx
			.select({
				completedByMemberId: choreCompletions.completedByMemberId,
				completedAt: choreCompletions.completedAt,
			})
			.from(choreCompletions)
			.where(
				and(eq(choreCompletions.id, input.completionId), eq(choreCompletions.choreId, choreId)),
			)
			.limit(1);
		if (!completion) return { ok: false, error: 'completion_not_found' };
		if (completion.completedByMemberId !== actor.memberId) return { ok: false, error: 'not_owner' };
		if (now - chore.updatedAt.getTime() > UNDO_WINDOW_MS) {
			return { ok: false, error: 'undo_expired' };
		}
		const [later] = await tx
			.select({ id: choreCompletions.id })
			.from(choreCompletions)
			.where(
				and(
					eq(choreCompletions.choreId, choreId),
					ne(choreCompletions.id, input.completionId),
					gt(choreCompletions.completedAt, completion.completedAt),
				),
			)
			.limit(1);
		if (later) return { ok: false, error: 'not_latest_completion' };

		const assigneeMatch = input.expected.assignedMemberId
			? eq(chores.assignedMemberId, input.expected.assignedMemberId)
			: isNull(chores.assignedMemberId);
		const [restored] = await tx
			.update(chores)
			.set({
				nextDueAt: input.previous.nextDueAt,
				assignedMemberId: assignee,
				anchorAt: input.previous.anchorAt,
				updatedAt: sql`greatest(clock_timestamp(), ${chores.updatedAt} + interval '1 millisecond')`,
				// Same as completing: a new assignee is not muted by the previous one's reminder throttle.
				...(assignee !== chore.assignedMemberId ? { lastReminderAt: null } : {}),
			})
			.where(
				and(eq(chores.id, choreId), assigneeMatch, eq(chores.nextDueAt, input.expected.nextDueAt)),
			)
			.returning();
		if (!restored) return { ok: false, error: 'chore_changed' };

		// `complete` closed the chore's swap request with this completion's time; ask again.
		await tx
			.update(announcements)
			.set({ status: 'open', resolvedAt: null, resolvedByMemberId: null, updatedAt: new Date(now) })
			.where(
				and(
					eq(announcements.wgId, wgId),
					eq(announcements.status, 'resolved'),
					eq(announcements.source, 'chore_swap'),
					eq(announcements.resolvedByMemberId, actor.memberId),
					eq(announcements.resolvedAt, completion.completedAt),
					choreSwapSourcePath(choreId),
				),
			);
		await tx.delete(choreCompletions).where(eq(choreCompletions.id, input.completionId));
		await tx.insert(auditEvents).values(
			auditValues({
				wgId,
				memberId: actor.memberId,
				eventType: 'chore.completion_undone',
				entityType: 'chore',
				entityId: choreId,
				actorName: actor.name,
				metadata: { title: chore.title },
			}),
		);
		return { ok: true, chore: restored };
	});
}
