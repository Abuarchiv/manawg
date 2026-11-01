import { and, eq, gte, isNull } from 'drizzle-orm';
import { startOfBerlinDay } from '@/core/utils/berlin-day';
import { chores, memberAbsences, wgMembers } from './schema';
import type { DbTransaction } from './transaction';

/**
 * Frees every chore assigned to a member who is leaving the WG (move-out or
 * account deletion). Otherwise the chore stays with someone who left: no
 * reminder reaches anyone, and the plan only flags it after two days overdue
 * instead of as "Niemand zuständig". Ongoing and future absences go too, so
 * Start and the cleaning rota stop listing someone who moved out as "abwesend";
 * past ones stay as history (account deletion erases them separately).
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

/**
 * Whether the member is still active in the WG, holding a shared row lock until commit. Move-out
 * takes the member row FOR UPDATE before it frees their chores, so it waits for a write that
 * assigns the chore and then releases it; without the lock the chore would stay with the leaver.
 */
export async function lockActiveMember(
	tx: DbTransaction,
	wgId: string,
	memberId: string,
): Promise<boolean> {
	const rows = await tx
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(eq(wgMembers.id, memberId), eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)),
		)
		.limit(1)
		.for('share');
	return rows.length > 0;
}
