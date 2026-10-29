import { berlinCalendarDayDistance } from '@/core/utils/berlin-day';
import { parseTimestamp } from '@/core/utils/time';
import type { Message } from '@/shared/i18n/message';

/** What the confirm step of a chore asks for: a plain completion or a late one. */
export type ChoreAction = 'complete' | 'catchUp';

type ChoreStatusState = 'planned' | 'due' | 'overdue' | 'unknown';

interface ChoreStatus {
	state: ChoreStatusState;
	label: Message;
	action: ChoreAction;
	overdueDays: number;
	escalated: boolean;
}

interface ChoreHealthInput {
	nextDueAt: string;
}

interface ChoreRepairInput {
	assignedMemberId: string | null;
	nextDueAt: string;
	/** The assignee is away on the due day (or today if overdue); the rotation only moves the chore on completion. */
	assigneeAbsent?: boolean;
}

interface ChorePlanHealth {
	gaps: number;
	dueToday: number;
}

export function calendarDayDistance(iso: string, now: number): number | null {
	const dueAt = parseTimestamp(iso);
	return dueAt === null ? null : berlinCalendarDayDistance(new Date(now), new Date(dueAt));
}

export function getChoreStatus(iso: string, now = Date.now()): ChoreStatus {
	const diffDays = calendarDayDistance(iso, now);
	if (diffDays === null) {
		return {
			state: 'unknown',
			label: { key: 'chores.status.unknown' },
			action: 'complete',
			overdueDays: 0,
			escalated: false,
		};
	}

	if (diffDays < 0) {
		const overdueDays = Math.abs(diffDays);
		const escalated = overdueDays >= 2;
		return {
			state: 'overdue',
			label: { key: 'chores.status.overdue', values: { days: overdueDays } },
			action: 'catchUp',
			overdueDays,
			escalated,
		};
	}

	if (diffDays === 0) {
		return {
			state: 'due',
			label: { key: 'chores.status.dueToday' },
			action: 'complete',
			overdueDays: 0,
			escalated: false,
		};
	}

	return {
		state: 'planned',
		label:
			diffDays === 1
				? { key: 'chores.status.tomorrow' }
				: { key: 'chores.status.inDays', values: { days: diffDays } },
		action: 'complete',
		overdueDays: 0,
		escalated: false,
	};
}

export function getChorePlanHealth(items: ChoreHealthInput[], now = Date.now()): ChorePlanHealth {
	const statuses = items.map((item) => getChoreStatus(item.nextDueAt, now));
	return {
		gaps: statuses.filter((status) => status.state === 'overdue').length,
		dueToday: statuses.filter((status) => status.state === 'due').length,
	};
}

/** True when the chore needs someone to step in: no assignee, an absent assignee, or escalated overdue. */
export function choreNeedsRepair(item: ChoreRepairInput, now = Date.now()): boolean {
	if (!item.assignedMemberId || item.assigneeAbsent) return true;
	return getChoreStatus(item.nextDueAt, now).escalated;
}

export type ChoreGroupKey = 'mine' | 'overdue' | 'week' | 'later';

const CHORE_GROUPS: { key: ChoreGroupKey; label: Message }[] = [
	{ key: 'mine', label: { key: 'chores.groups.mine' } },
	{ key: 'overdue', label: { key: 'chores.groups.overdue' } },
	{ key: 'week', label: { key: 'chores.groups.week' } },
	{ key: 'later', label: { key: 'chores.groups.later' } },
];

/** Own chores due by tomorrow come first, others follow by urgency. */
function getChoreGroup(
	chore: ChoreRepairInput,
	currentMemberId: string,
	now = Date.now(),
): ChoreGroupKey {
	const days = calendarDayDistance(chore.nextDueAt, now);
	if (days === null) return 'later';
	if (chore.assignedMemberId === currentMemberId && days <= 1) return 'mine';
	if (days < 0) return 'overdue';
	return days <= 7 ? 'week' : 'later';
}

/** Chores in need of repair come first within each group; empty groups are dropped. */
export function groupChoresForPlan<T extends ChoreRepairInput>(
	chores: T[],
	currentMemberId: string,
	now = Date.now(),
): { key: ChoreGroupKey; label: Message; chores: T[] }[] {
	const needsRepair = (chore: T) => (choreNeedsRepair(chore, now) ? 0 : 1);
	const sorted = [...chores].sort((a, b) => needsRepair(a) - needsRepair(b));
	return CHORE_GROUPS.map((group) => ({
		...group,
		chores: sorted.filter((chore) => getChoreGroup(chore, currentMemberId, now) === group.key),
	})).filter((group) => group.chores.length > 0);
}

/** Keeps only overdue chores (for `?filter=overdue`); groups left empty are dropped. */
export function filterOverdueGroups<T extends { nextDueAt: string }>(
	groups: { key: ChoreGroupKey; label: Message; chores: T[] }[],
	now = Date.now(),
): { key: ChoreGroupKey; label: Message; chores: T[] }[] {
	return groups
		.map((group) => ({
			...group,
			chores: group.chores.filter(
				(chore) => getChoreStatus(chore.nextDueAt, now).state === 'overdue',
			),
		}))
		.filter((group) => group.chores.length > 0);
}
