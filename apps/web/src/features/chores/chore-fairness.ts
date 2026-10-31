import { parseValidDate } from '@/core/utils/time';
import { getAbsentMemberIds } from '@/features/chores/absence';
import { computeNextDueAt } from '@/features/chores/chore-recurrence';
import { getChoreStatus } from '@/features/chores/chore-status';
import type { RecurrenceType } from '@/features/chores/components/chore-types';

interface MemberInput {
	id: string;
	name: string;
}

interface ChoreInput {
	assignedMemberId: string | null;
	openGapCountForAssignee: number;
	nextDueAt: string;
}

interface ChoreGapInput {
	assignedMemberId: string | null;
	nextDueAt: string;
}

/**
 * Counts, per assignee, how many of their currently assigned chores are
 * overdue ("open gaps"). This is the single source of truth for
 * `openGapCountForAssignee` — both GET /api/wg/[code]/chores (which shows the
 * count in the UI) and the chore completion route (which feeds it into
 * `chooseNextAvailableMember` for the "Nächste:r" rotation) must call this
 * so the fairness prediction the UI shows never diverges from what the
 * server actually decides.
 */
export function computeOpenGapsByMember(
	chores: ChoreGapInput[],
	now: number = Date.now(),
): Map<string, number> {
	const openGapsByMember = new Map<string, number>();
	for (const chore of chores) {
		if (!chore.assignedMemberId) continue;
		if (getChoreStatus(chore.nextDueAt, now).state !== 'overdue') continue;
		openGapsByMember.set(
			chore.assignedMemberId,
			(openGapsByMember.get(chore.assignedMemberId) ?? 0) + 1,
		);
	}
	return openGapsByMember;
}

interface ChoreFairnessRow {
	id: string;
	name: string;
	assignedCount: number;
	openGapCount: number;
	overdueCount: number;
	score: number;
	available: boolean;
}

export interface ChoreFairness {
	rows: ChoreFairnessRow[];
	suggestedAssignee: ChoreFairnessRow | null;
}

export function buildChoreFairness(input: {
	members: MemberInput[];
	chores: ChoreInput[];
	absentMemberIds?: string[];
	now?: number;
}): ChoreFairness {
	const now = input.now ?? Date.now();
	const absent = new Set(input.absentMemberIds ?? []);
	const rows = input.members.map<ChoreFairnessRow>((member) => {
		const assigned = input.chores.filter((chore) => chore.assignedMemberId === member.id);
		// GET repeats the assignee-wide total on every chore, so count that
		// snapshot once instead of multiplying it by the assignee's task count.
		const openGapCount = assigned.reduce(
			(max, chore) => Math.max(max, chore.openGapCountForAssignee),
			0,
		);
		const overdueCount = assigned.filter(
			(chore) => getChoreStatus(chore.nextDueAt, now).state === 'overdue',
		).length;
		return {
			id: member.id,
			name: member.name,
			assignedCount: assigned.length,
			openGapCount,
			overdueCount,
			score: assigned.length * 2 + openGapCount * 3 + overdueCount * 2,
			available: !absent.has(member.id),
		};
	});
	const suggestedAssignee =
		rows
			.filter((row) => row.available)
			.slice()
			.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))[0] ?? null;
	return { rows, suggestedAssignee };
}

export function chooseNextAvailableMember(input: {
	members: MemberInput[];
	currentMemberId: string | null;
	absentMemberIds?: string[];
	// Optional chore snapshot — when supplied, picks the lowest-scored
	// available member (matching the UI's `buildChoreFairness.suggestedAssignee`
	// hint). Ties broken by round-robin distance from current owner so the
	// rotation still cycles when everyone is equally loaded. Without this
	// snapshot, falls back to pure round-robin.
	chores?: ChoreInput[];
	now?: number;
}): string | null {
	if (input.members.length === 0) return null;
	const absent = new Set(input.absentMemberIds ?? []);

	// Score-aware path: use the same fairness ranker the UI shows, so the
	// "Nächste:r: X" hint matches the actual rotation server-side. Prevents
	// the UI/server drift where UI promised one assignee and the API picked
	// a different one.
	if (input.chores && input.chores.length > 0) {
		// `exactOptionalPropertyTypes` rejects passing `undefined` for optional
		// fields — only include them when defined.
		const fairnessInput: Parameters<typeof buildChoreFairness>[0] = {
			members: input.members,
			chores: input.chores,
		};
		if (input.absentMemberIds !== undefined) {
			fairnessInput.absentMemberIds = input.absentMemberIds;
		}
		if (input.now !== undefined) {
			fairnessInput.now = input.now;
		}
		const fairness = buildChoreFairness(fairnessInput);
		const available = fairness.rows.filter((row) => row.available);
		if (available.length === 0) return null;
		const withoutCurrent = available.filter((row) => row.id !== input.currentMemberId);
		const candidates = withoutCurrent.length > 0 ? withoutCurrent : available;
		const minScore = Math.min(...candidates.map((row) => row.score));
		const tied = candidates.filter((row) => row.score === minScore);
		const firstTied = tied[0];
		if (tied.length === 1 && firstTied) return firstTied.id;
		// Round-robin tiebreak: pick the next tied member after the current
		// owner so consecutive completions still cycle visibly. The owner may
		// be excluded from candidates, so scan the member order from that owner.
		const tiedIds = new Set(tied.map((row) => row.id));
		const currentIdx = input.currentMemberId
			? input.members.findIndex((member) => member.id === input.currentMemberId)
			: -1;
		for (let offset = 1; offset <= input.members.length; offset += 1) {
			const idx = (Math.max(currentIdx, -1) + offset) % input.members.length;
			const member = input.members[idx];
			if (member && tiedIds.has(member.id)) return member.id;
		}
		return firstTied?.id ?? null;
	}

	const startIndex = input.currentMemberId
		? input.members.findIndex((member) => member.id === input.currentMemberId)
		: -1;
	for (let offset = 1; offset <= input.members.length; offset += 1) {
		const idx = (Math.max(startIndex, -1) + offset) % input.members.length;
		const member = input.members[idx];
		if (member && !absent.has(member.id)) return member.id;
	}
	return null;
}

/**
 * Mirrors the complete route: availability is checked on the next due day, not today.
 * The anchor keeps the month-end day equal to the complete route's, so the absence check
 * lands on the same calendar day.
 */
export function predictNextAssigneeId(
	chore: {
		nextDueAt: string;
		anchorAt?: string;
		intervalDays: number;
		recurrenceType: RecurrenceType;
		assignedMemberId: string | null;
	},
	chores: ChoreInput[],
	members: MemberInput[],
	absences: Parameters<typeof getAbsentMemberIds>[0],
): string | null {
	// An unreadable date must not break the whole plan: the row then shows "Datum prüfen".
	const dueAt = chore.nextDueAt ? parseValidDate(chore.nextDueAt) : null;
	if (!dueAt) return null;
	const anchor = chore.anchorAt ? parseValidDate(chore.anchorAt) : null;
	const nextDueAt = computeNextDueAt(
		dueAt,
		chore.intervalDays,
		new Date(),
		chore.recurrenceType,
		anchor ?? undefined,
	);
	return chooseNextAvailableMember({
		members,
		currentMemberId: chore.assignedMemberId,
		absentMemberIds: getAbsentMemberIds(absences, nextDueAt.getTime()),
		chores,
	});
}
