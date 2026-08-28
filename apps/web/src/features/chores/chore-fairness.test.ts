import { describe, expect, it } from 'vitest';
import {
	buildChoreFairness,
	chooseNextAvailableMember,
	computeOpenGapsByMember,
} from './chore-fairness';

describe('computeOpenGapsByMember', () => {
	it('counts overdue chores per assignee', () => {
		const now = new Date('2026-05-18T00:00:00Z').getTime();
		const result = computeOpenGapsByMember(
			[
				{ assignedMemberId: 'a', nextDueAt: '2026-05-10T00:00:00Z' }, // overdue
				{ assignedMemberId: 'a', nextDueAt: '2026-05-11T00:00:00Z' }, // overdue
				{ assignedMemberId: 'a', nextDueAt: '2026-05-20T00:00:00Z' }, // not yet due
				{ assignedMemberId: 'b', nextDueAt: '2026-05-01T00:00:00Z' }, // overdue
			],
			now,
		);

		expect(result.get('a')).toBe(2);
		expect(result.get('b')).toBe(1);
	});

	it('ignores unassigned chores', () => {
		const now = new Date('2026-05-18T00:00:00Z').getTime();
		const result = computeOpenGapsByMember(
			[{ assignedMemberId: null, nextDueAt: '2026-05-01T00:00:00Z' }],
			now,
		);

		expect(result.size).toBe(0);
	});

	it('returns an empty map when no chores are overdue', () => {
		const now = new Date('2026-05-18T00:00:00Z').getTime();
		const result = computeOpenGapsByMember(
			[{ assignedMemberId: 'a', nextDueAt: '2026-05-25T00:00:00Z' }],
			now,
		);

		expect(result.size).toBe(0);
	});
});

describe('buildChoreFairness', () => {
	it('summarizes workload and suggests the fairest next assignee', () => {
		const fairness = buildChoreFairness({
			members: [
				{ id: 'a', name: 'Ava' },
				{ id: 'b', name: 'Ben' },
			],
			chores: [
				{ assignedMemberId: 'a', openGapCountForAssignee: 2, nextDueAt: '2026-05-15T00:00:00Z' },
				{ assignedMemberId: 'a', openGapCountForAssignee: 0, nextDueAt: '2026-05-19T00:00:00Z' },
			],
			now: new Date('2026-05-18T00:00:00Z').getTime(),
		});

		expect(fairness.suggestedAssignee?.name).toBe('Ben');
		expect(fairness.rows.map((row) => [row.name, row.assignedCount, row.openGapCount])).toEqual([
			['Ava', 2, 2],
			['Ben', 0, 0],
		]);
		expect(fairness.insights[0]).toBe('Ava hat aktuell 2 Aufgaben und 2 offene Lücken.');
	});

	it('skips absent members when suggesting the next assignee', () => {
		const fairness = buildChoreFairness({
			members: [
				{ id: 'a', name: 'Ava' },
				{ id: 'b', name: 'Ben' },
			],
			chores: [],
			absentMemberIds: ['a'],
			now: new Date('2026-05-18T00:00:00Z').getTime(),
		});

		expect(fairness.suggestedAssignee?.name).toBe('Ben');
		expect(fairness.rows.find((row) => row.id === 'a')?.available).toBe(false);
	});

	it('ignores invalid due dates when counting overdue workload', () => {
		const fairness = buildChoreFairness({
			members: [{ id: 'a', name: 'Ava' }],
			chores: [{ assignedMemberId: 'a', openGapCountForAssignee: 0, nextDueAt: 'broken' }],
			now: new Date('2026-05-18T00:00:00Z').getTime(),
		});

		expect(fairness.rows[0]?.overdueCount).toBe(0);
		expect(fairness.rows[0]?.score).toBe(2);
	});

	it('does not multiply per-assignee open gaps across multiple assigned chores', () => {
		const future = new Date('2026-05-20T00:00:00Z').toISOString();
		const fairness = buildChoreFairness({
			members: [{ id: 'a', name: 'Ava' }],
			chores: [
				{ assignedMemberId: 'a', openGapCountForAssignee: 2, nextDueAt: future },
				{ assignedMemberId: 'a', openGapCountForAssignee: 2, nextDueAt: future },
			],
			now: new Date('2026-05-18T00:00:00Z').getTime(),
		});

		expect(fairness.rows[0]?.openGapCount).toBe(2);
		expect(fairness.rows[0]?.score).toBe(10);
		expect(fairness.insights[0]).toBe('Ava hat aktuell 2 Aufgaben und 2 offene Lücken.');
	});
});

describe('chooseNextAvailableMember', () => {
	it('rotates to the next non-absent member', () => {
		expect(
			chooseNextAvailableMember({
				members: [
					{ id: 'a', name: 'Ava' },
					{ id: 'b', name: 'Ben' },
					{ id: 'c', name: 'Can' },
				],
				currentMemberId: 'a',
				absentMemberIds: ['b'],
			}),
		).toBe('c');
	});

	it('produces a stable A→B→C→A cycle across three members (Case A: fairness)', () => {
		const members = [
			{ id: 'a', name: 'Ava' },
			{ id: 'b', name: 'Ben' },
			{ id: 'c', name: 'Can' },
		];
		const sequence: string[] = [];
		let current: string | null = 'a';
		for (let i = 0; i < 6; i += 1) {
			const next = chooseNextAvailableMember({ members, currentMemberId: current });
			expect(next).not.toBeNull();
			sequence.push(next as string);
			current = next;
		}
		expect(sequence).toEqual(['b', 'c', 'a', 'b', 'c', 'a']);
	});

	it('inserts a newly-joined member at the end of the cycle (Case B)', () => {
		// A, B, C with createdAt order; D joins last.
		const withD = [
			{ id: 'a', name: 'Ava' },
			{ id: 'b', name: 'Ben' },
			{ id: 'c', name: 'Can' },
			{ id: 'd', name: 'Dee' },
		];
		// After C completes → next should be D, not A (D gets a turn first).
		expect(chooseNextAvailableMember({ members: withD, currentMemberId: 'c' })).toBe('d');
	});

	it('skips a removed member by picking the next live one (Case C)', () => {
		// Original B was current/next but has been deleted from wgMembers.
		const aliveAfterB = [
			{ id: 'a', name: 'Ava' },
			{ id: 'c', name: 'Can' },
		];
		// A just completed; B no longer exists; cycle should advance to C.
		expect(chooseNextAvailableMember({ members: aliveAfterB, currentMemberId: 'a' })).toBe('c');
	});

	it('returns the same member in a solo WG without crashing (Case I)', () => {
		const solo = [{ id: 'a', name: 'Ava' }];
		expect(chooseNextAvailableMember({ members: solo, currentMemberId: 'a' })).toBe('a');
	});

	it('returns null when every member is absent', () => {
		expect(
			chooseNextAvailableMember({
				members: [
					{ id: 'a', name: 'Ava' },
					{ id: 'b', name: 'Ben' },
				],
				currentMemberId: 'a',
				absentMemberIds: ['a', 'b'],
			}),
		).toBeNull();
	});

	it('picks the first member when the previous assignee no longer exists', () => {
		// currentMemberId was deleted; startIndex=-1 → falls through to first.
		expect(
			chooseNextAvailableMember({
				members: [
					{ id: 'a', name: 'Ava' },
					{ id: 'b', name: 'Ben' },
				],
				currentMemberId: 'ghost',
			}),
		).toBe('b');
	});

	describe('score-aware mode (matches UI suggestedAssignee)', () => {
		const members = [
			{ id: 'a', name: 'Ava' },
			{ id: 'b', name: 'Ben' },
			{ id: 'c', name: 'Cora' },
		];
		const future = new Date(Date.now() + 86_400_000).toISOString();

		it('picks the least-loaded available member instead of pure round-robin', () => {
			// Round-robin from 'a' would pick 'b'. But 'b' already has 2 chores
			// and 'c' has 0 — score-aware mode picks 'c'.
			const chores = [
				{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: future },
				{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: future },
			];
			expect(chooseNextAvailableMember({ members, currentMemberId: 'a', chores })).toBe('c');
		});

		it('breaks ties with round-robin distance from the current owner', () => {
			// Everyone has 0 chores → ties on score → next member after 'a' is 'b'.
			const chores: Array<{
				assignedMemberId: string | null;
				openGapCountForAssignee: number;
				nextDueAt: string;
			}> = [{ assignedMemberId: null, openGapCountForAssignee: 0, nextDueAt: future }];
			expect(chooseNextAvailableMember({ members, currentMemberId: 'a', chores })).toBe('b');
		});

		it('skips absent members even when they would win on score', () => {
			// 'c' has 0 chores (would win) but is absent → falls back to next-best 'a'.
			const chores = [
				{ assignedMemberId: 'a', openGapCountForAssignee: 0, nextDueAt: future },
				{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: future },
				{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: future },
			];
			const result = chooseNextAvailableMember({
				members,
				currentMemberId: 'a',
				absentMemberIds: ['c'],
				chores,
			});
			// 'a' has score=2, 'b' has score=4, 'c' absent → 'a' wins
			expect(result).toBe('a');
		});

		it('matches buildChoreFairness.suggestedAssignee — UI/server agreement', () => {
			// Critical invariant: whatever the UI tells the user is "Nächste:r",
			// the server must actually rotate to. Drift caused user reports
			// like "UI said Anna but app gave it to Bob" in iter 8.
			const chores = [
				{ assignedMemberId: 'a', openGapCountForAssignee: 1, nextDueAt: future },
				{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: future },
			];
			const fairness = buildChoreFairness({ members, chores });
			const serverPick = chooseNextAvailableMember({
				members,
				currentMemberId: 'a',
				chores,
			});
			expect(serverPick).toBe(fairness.suggestedAssignee?.id);
		});
	});
});
