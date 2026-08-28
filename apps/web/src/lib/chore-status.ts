import { MS_PER_DAY, parseTimestamp } from './time';

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
	escalationLabel: 'Bitte klären' | null;
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
	text: string;
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

export function getChoreStatus(iso: string, now = Date.now()): ChoreStatus {
	const dueAt = parseTimestamp(iso);
	if (dueAt === null) {
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
	const diffDays = Math.round((dueAt - now) / MS_PER_DAY);

	if (diffDays < 0) {
		const overdueDays = Math.abs(diffDays);
		const escalated = overdueDays >= 2;
		return {
			state: 'overdue',
			tone: 'overdue',
			label: `${overdueDays} T. überfällig`,
			detail: `Lücke im Plan: seit ${overdueDays} ${
				overdueDays === 1 ? 'Tag' : 'Tagen'
			} offen${escalated ? ' · bitte nachholen oder tauschen' : ''}`,
			actionLabel: 'Nachholen',
			overdueDays,
			escalated,
			escalationLabel: escalated ? 'Bitte klären' : null,
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
			text: 'Noch keine Aufgaben im Plan',
		};
	}

	const statuses = items.map((item) => getChoreStatus(item.nextDueAt, now));
	const gaps = statuses.filter((status) => status.state === 'overdue').length;
	const dueToday = statuses.filter((status) => status.state === 'due').length;
	const escalated = statuses.filter((status) => status.escalated).length;
	const nextLabel = statuses[0]?.label ?? 'keine';
	const gapText = gaps === 1 ? '1 Lücke' : `${gaps} Lücken`;
	const clarifyText = escalated > 0 ? ` · ${escalated} klären` : '';

	return {
		total: items.length,
		gaps,
		dueToday,
		escalated,
		nextLabel,
		text: `${items.length} Aufgaben offen · ${gapText}${clarifyText} · nächste Fälligkeit ${nextLabel}`,
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
		title: `Lücke seit ${status.overdueDays} Tagen`,
		action: 'Neu zuweisen oder nachholen',
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
