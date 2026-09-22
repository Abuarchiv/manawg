import { berlinDayKey } from '@/core/utils/berlin-day';
import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';

type ChoreStatusState = 'planned' | 'due' | 'overdue' | 'unknown';
type ChoreStatusTone = 'ok' | 'soon' | 'overdue';

interface ChoreStatus {
	state: ChoreStatusState;
	tone: ChoreStatusTone;
	label: string;
	detail: string;
	actionLabel: 'Erledigt' | 'Nachholen';
	overdueDays: number;
	escalated: boolean;
	escalationLabel: 'Klärung offen' | null;
}

interface ChoreHealthInput {
	nextDueAt: string;
}

interface ChoreRepairInput {
	assignedMemberId: string | null;
	nextDueAt: string;
}

interface ChoreRepairHint {
	tone: 'danger' | 'neutral';
	title: string;
	action: string;
}

interface ChorePlanHealth {
	total: number;
	gaps: number;
	dueToday: number;
	escalated: number;
	nextLabel: string;
}

export interface ChoreAssigneeMember {
	id: string;
	name: string;
}

interface ChoreAssigneeInput {
	members: ChoreAssigneeMember[];
	chores: ChoreRepairInput[];
	now?: number;
}

function berlinCalendarDayMs(key: string): number {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
	if (!match) throw new Error(`Unexpected Berlin day key: ${key}`);
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function calendarDayDistance(iso: string, now: number): number | null {
	const dueAt = parseTimestamp(iso);
	if (dueAt === null) return null;
	const dueKey = berlinDayKey(new Date(dueAt));
	const nowKey = berlinDayKey(new Date(now));
	return (berlinCalendarDayMs(dueKey) - berlinCalendarDayMs(nowKey)) / MS_PER_DAY;
}

export function getChoreStatus(iso: string, now = Date.now()): ChoreStatus {
	const diffDays = calendarDayDistance(iso, now);
	if (diffDays === null) {
		return {
			state: 'unknown',
			tone: 'soon',
			label: 'Datum prüfen',
			detail: 'Fälligkeit ist unklar',
			actionLabel: 'Erledigt',
			overdueDays: 0,
			escalated: false,
			escalationLabel: null,
		};
	}

	if (diffDays < 0) {
		const overdueDays = Math.abs(diffDays);
		const escalated = overdueDays >= 2;
		return {
			state: 'overdue',
			tone: 'overdue',
			label: `seit ${overdueDays} T. offen`,
			detail: `Seit ${overdueDays} ${overdueDays === 1 ? 'Tag' : 'Tagen'} offen`,
			actionLabel: 'Nachholen',
			overdueDays,
			escalated,
			escalationLabel: escalated ? 'Klärung offen' : null,
		};
	}

	if (diffDays === 0) {
		return {
			state: 'due',
			tone: 'soon',
			label: 'heute fällig',
			detail: 'Heute offen',
			actionLabel: 'Erledigt',
			overdueDays: 0,
			escalated: false,
			escalationLabel: null,
		};
	}

	return {
		state: 'planned',
		tone: diffDays <= 3 ? 'soon' : 'ok',
		label: diffDays === 1 ? 'morgen' : `in ${diffDays} T.`,
		detail: 'Geplant',
		actionLabel: 'Erledigt',
		overdueDays: 0,
		escalated: false,
		escalationLabel: null,
	};
}

export function getChorePlanHealth(items: ChoreHealthInput[], now = Date.now()): ChorePlanHealth {
	if (items.length === 0) {
		return {
			total: 0,
			gaps: 0,
			dueToday: 0,
			escalated: 0,
			nextLabel: 'keine',
		};
	}

	const statuses = items.map((item) => getChoreStatus(item.nextDueAt, now));
	const gaps = statuses.filter((status) => status.state === 'overdue').length;
	const dueToday = statuses.filter((status) => status.state === 'due').length;
	const escalated = statuses.filter((status) => status.escalated).length;
	const nextLabel = statuses[0]?.label ?? 'keine';

	return {
		total: items.length,
		gaps,
		dueToday,
		escalated,
		nextLabel,
	};
}

export function getChoreRepairHint(
	item: ChoreRepairInput,
	now = Date.now(),
): ChoreRepairHint | null {
	if (!item.assignedMemberId) {
		return {
			tone: 'danger',
			title: 'Niemand zuständig',
			action: 'Person zuweisen',
		};
	}

	const status = getChoreStatus(item.nextDueAt, now);
	if (!status.escalated) return null;

	return {
		tone: 'danger',
		title: `Offen seit ${status.overdueDays} Tagen`,
		action: 'Neu zuweisen oder erledigen',
	};
}

export function suggestChoreAssignee(input: ChoreAssigneeInput): ChoreAssigneeMember | null {
	if (input.members.length === 0) return null;
	const now = input.now ?? Date.now();
	const scores = new Map(input.members.map((member) => [member.id, 0]));

	for (const chore of input.chores) {
		if (!chore.assignedMemberId || !scores.has(chore.assignedMemberId)) continue;
		const status = getChoreStatus(chore.nextDueAt, now);
		const weight = status.state === 'overdue' ? 4 : status.state === 'due' ? 2 : 1;
		scores.set(chore.assignedMemberId, (scores.get(chore.assignedMemberId) ?? 0) + weight);
	}

	return (
		[...input.members].sort((a, b) => {
			const scoreDiff = (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0);
			if (scoreDiff !== 0) return scoreDiff;
			return a.name.localeCompare(b.name, 'de-DE');
		})[0] ?? null
	);
}

export type ChoreGroupKey = 'mine' | 'overdue' | 'week' | 'later';

export const CHORE_GROUPS: { key: ChoreGroupKey; label: string }[] = [
	{ key: 'mine', label: 'Für dich' },
	{ key: 'overdue', label: 'Noch offen' },
	{ key: 'week', label: 'Diese Woche' },
	{ key: 'later', label: 'Später' },
];

/** Eigene Aufgaben bis morgen stehen oben, fremde nach Dringlichkeit darunter. */
export function getChoreGroup(
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
