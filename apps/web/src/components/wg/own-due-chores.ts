import { berlinCalendarDayDistance } from '@/core/utils/berlin-day';
import { parseTimestamp } from '@/core/utils/time';

export interface DueChoreRef {
	assignedMemberId: string | null;
	nextDueAt: string;
}

/**
 * Chores of `memberId` that are due today or overdue on the Berlin calendar, the same
 * cut-off as the chore status `due`/`overdue` states. An unreadable date never counts.
 */
export function countOwnDueChores(
	chores: readonly DueChoreRef[],
	memberId: string,
	now = Date.now(),
): number {
	return chores.filter((chore) => {
		if (chore.assignedMemberId !== memberId) return false;
		const dueAt = parseTimestamp(chore.nextDueAt);
		return dueAt !== null && berlinCalendarDayDistance(new Date(now), new Date(dueAt)) <= 0;
	}).length;
}
