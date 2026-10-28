import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { announcements, db } from '@/core/db';
import type { DbTransaction } from '@/core/db/transaction';
import { logApiError } from '@/core/infra/observability';

/** Matches a chore's swap request; requests created before the route rename point at /putzen. */
export function choreSwapSourcePath(choreId: string) {
	const id = encodeURIComponent(choreId);
	return inArray(announcements.sourcePath, [`/chores?highlight=${id}`, `/putzen?highlight=${id}`]);
}

/** Closes the open swap request inside the caller's transaction; a failure aborts it. */
export async function closeChoreSwapRequest(
	executor: DbTransaction | typeof db,
	wgId: string,
	choreId: string,
	resolvedByMemberId: string,
): Promise<void> {
	const now = new Date();
	await executor
		.update(announcements)
		.set({ status: 'resolved', resolvedAt: now, resolvedByMemberId, updatedAt: now })
		.where(
			and(
				eq(announcements.wgId, wgId),
				eq(announcements.status, 'open'),
				eq(announcements.source, 'chore_swap'),
				choreSwapSourcePath(choreId),
			),
		);
}

/**
 * Closes the open Pinnwand swap request of a chore once the question is settled
 * (someone took it over or the chore is gone). Best-effort like the shopping
 * counterpart: a failed update must not fail the chore mutation itself.
 */
export async function resolveChoreSwapRequest(
	wgId: string,
	choreId: string,
	resolvedByMemberId: string,
): Promise<void> {
	try {
		await closeChoreSwapRequest(db, wgId, choreId, resolvedByMemberId);
	} catch (err) {
		logApiError('[chores] swap request resolve failed', err);
	}
}
