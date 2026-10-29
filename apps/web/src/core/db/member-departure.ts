import { and, eq, gte } from 'drizzle-orm';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import { chores, memberAbsences } from './schema';
import type { DbTransaction } from './transaction';

/**
 * Frees every chore assigned to a member who is leaving the WG (move-out or
 * account deletion). Otherwise the chore stays with someone who left: no
 * reminder reaches anyone, and the plan only flags it after two days overdue
 * instead of as "Niemand zuständig". Ongoing and future absences go too, so
 * Start and the cleaning rota stop listing someone who moved out as "abwesend";
 * past ones stay as history.
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
	await tx.delete(memberAbsences).where(
		and(
			eq(memberAbsences.wgId, wgId),
			eq(memberAbsences.memberId, memberId),
			// Absence days are inclusive, so one ending today still counts as ongoing.
			gte(memberAbsences.endDate, startOfBerlinDay(new Date())),
		),
	);
}
