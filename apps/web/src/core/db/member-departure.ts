import { and, eq } from 'drizzle-orm';
import { chores } from './schema';
import type { DbTransaction } from './transaction';

/**
 * Frees every chore assigned to a member who is leaving the WG (move-out or
 * account deletion). Otherwise the chore stays with someone who left: no
 * reminder reaches anyone, and the plan only flags it after two days overdue
 * instead of as "Niemand zuständig".
 */
export async function releaseMemberChores(
	tx: DbTransaction,
	wgId: string,
	memberId: string,
): Promise<void> {
	await tx
		.update(chores)
		.set({ assignedMemberId: null, lastReminderAt: null, updatedAt: new Date() })
		.where(and(eq(chores.wgId, wgId), eq(chores.assignedMemberId, memberId)));
}
