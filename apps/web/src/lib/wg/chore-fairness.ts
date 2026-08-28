import { getChoreStatus } from '@/lib/chore-status';
import { parseTimestamp } from '@/lib/time';

const MS_PER_DAY = 86_400_000;

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

export interface ChoreFairnessRow {
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
	insights: string[];
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
		const openGapCount = Math.max(0, ...assigned.map((chore) => chore.openGapCountForAssignee));
		const overdueCount = assigned.filter((chore) => {
			const nextDueAt = parseTimestamp(chore.nextDueAt);
			return nextDueAt !== null && nextDueAt < now - MS_PER_DAY;
		}).length;
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
	const busiest = rows.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0];
	const absentCount = rows.filter((row) => !row.available).length;
	const insights =
		busiest && busiest.assignedCount + busiest.openGapCount > 0
			? [
					`${busiest.name} hat aktuell ${busiest.assignedCount} Aufgaben und ${busiest.openGapCount} offene Lücken.`,
				]
			: ['Die Aufgaben sind noch nicht verteilt.'];
	if (absentCount > 0) {
		const personWord = absentCount === 1 ? 'Person wird' : 'Personen werden';
		insights.push(`${absentCount} ${personWord} wegen Abwesenheit übersprungen.`);
	}

	return { rows, suggestedAssignee, insights };
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
		const minScore = Math.min(...available.map((row) => row.score));
		const tied = available.filter((row) => row.score === minScore);
		const firstTied = tied[0];
		if (tied.length === 1 && firstTied) return firstTied.id;
		// Round-robin tiebreak: pick the next tied member after the current
		// owner so consecutive completions still cycle visibly.
		const tiedIds = new Set(tied.map((row) => row.id));
		const ordered = input.members.filter((m) => tiedIds.has(m.id));
		if (ordered.length === 0) return null;
		const startIdx = input.currentMemberId
			? ordered.findIndex((m) => m.id === input.currentMemberId)
			: -1;
		const pick = ordered[startIdx >= 0 ? (startIdx + 1) % ordered.length : 0];
		return pick ? pick.id : null;
	}

	const startIndex = input.currentMemberId
		? input.members.findIndex((member) => member.id === input.currentMemberId)
		: -1;
	for (let offset = 1; offset <= input.members.length; offset += 1) {
		const idx = (Math.max(startIndex, 0) + offset) % input.members.length;
		const member = input.members[idx];
		if (member && !absent.has(member.id)) return member.id;
	}
	return null;
}
