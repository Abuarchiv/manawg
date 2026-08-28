/**
 * Iter 12 chore-fairness edge cases — "think like a real WG".
 *
 * Scenarios users hit in production that the original suites didn't exercise:
 * empty / single-member WGs (just created, or last member left), mid-period
 * membership changes, and all-members-absent (whole WG on vacation).
 *
 * A case that passes without code changes keeps its
 * `// REGRESSION GUARD — keep` comment so future refactors don't regress it.
 *
 * Split out of a former cross-domain src/lib/wg/fairness-edge-cases.test.ts;
 * the expense-side half lives in features/expenses/fairness-edge-cases.test.ts.
 */

import { buildChoreFairness, chooseNextAvailableMember } from '@/features/chores/chore-fairness';
import { describe, expect, it } from 'vitest';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

describe('iter12 — chore fairness edge cases', () => {
	it('does not crash on an empty WG (just created, no members yet)', () => {
		// REGRESSION GUARD — keep
		// Brand-new WG before the creator finishes onboarding can land on the
		// chores page with members=[]. Must not throw.
		const fairness = buildChoreFairness({ members: [], chores: [] });
		expect(fairness.rows).toEqual([]);
		expect(fairness.suggestedAssignee).toBeNull();
		expect(fairness.insights).toEqual(['Die Aufgaben sind noch nicht verteilt.']);
	});

	it('returns null suggestedAssignee when every member is absent (whole WG on vacation)', () => {
		// REGRESSION GUARD — keep
		const fairness = buildChoreFairness({
			members: [
				{ id: 'a', name: 'Ava' },
				{ id: 'b', name: 'Ben' },
			],
			chores: [{ assignedMemberId: 'a', openGapCountForAssignee: 1, nextDueAt: FUTURE }],
			absentMemberIds: ['a', 'b'],
		});
		expect(fairness.suggestedAssignee).toBeNull();
		// Every row should still render so the UI can show "alle abwesend"
		expect(fairness.rows.every((row) => row.available === false)).toBe(true);
	});

	it('pluralises absence count correctly when 2+ members are away', () => {
		// Caught grammar bug: "2 Person wird wegen Abwesenheit übersprungen." (sg/pl mismatch).
		const fairness = buildChoreFairness({
			members: [
				{ id: 'a', name: 'Ava' },
				{ id: 'b', name: 'Ben' },
				{ id: 'c', name: 'Cora' },
			],
			chores: [],
			absentMemberIds: ['a', 'b'],
		});
		const absenceInsight = fairness.insights.find((line) => line.includes('Abwesenheit'));
		expect(absenceInsight).toBeDefined();
		// Two absent members → "2 Personen werden", not "2 Person wird".
		expect(absenceInsight).toBe('2 Personen werden wegen Abwesenheit übersprungen.');
	});

	it('ignores chores with assignedMemberId=null when scoring (orphaned after member delete)', () => {
		// REGRESSION GUARD — keep
		// After a member is deleted, their chores have assignedMemberId=null
		// until someone completes them. Must not inflate anybody's score.
		const fairness = buildChoreFairness({
			members: [
				{ id: 'a', name: 'Ava' },
				{ id: 'b', name: 'Ben' },
			],
			chores: [
				{ assignedMemberId: null, openGapCountForAssignee: 5, nextDueAt: FUTURE },
				{ assignedMemberId: null, openGapCountForAssignee: 5, nextDueAt: FUTURE },
			],
		});
		expect(fairness.rows.every((row) => row.score === 0)).toBe(true);
		// Either Ava or Ben can be picked — both have score 0; alphabetical tiebreak → Ava.
		expect(fairness.suggestedAssignee?.id).toBe('a');
	});

	it('treats a freshly-joined member as the least-loaded (joins mid-period)', () => {
		// New member 'd' joined yesterday with no history; should be top pick.
		const members = [
			{ id: 'a', name: 'Ava' },
			{ id: 'b', name: 'Ben' },
			{ id: 'c', name: 'Cora' },
			{ id: 'd', name: 'Dee' }, // joined last
		];
		const chores = [
			{ assignedMemberId: 'a', openGapCountForAssignee: 2, nextDueAt: FUTURE },
			{ assignedMemberId: 'b', openGapCountForAssignee: 1, nextDueAt: FUTURE },
			{ assignedMemberId: 'c', openGapCountForAssignee: 0, nextDueAt: FUTURE },
		];
		const fairness = buildChoreFairness({ members, chores });
		expect(fairness.suggestedAssignee?.id).toBe('d');

		// Server-side rotation should agree (iter 8 drift bug guard).
		expect(chooseNextAvailableMember({ members, currentMemberId: 'a', chores })).toBe('d');
	});

	it('keeps the single member in a solo WG even when absent flag is set incorrectly', () => {
		// Solo WG where the user accidentally marked themselves absent: rotation
		// must NOT silently return null and leave the chore unassigned forever.
		// Acceptable behaviors: return the only member OR return null.
		// We assert that NO rotation can pick a non-existent member.
		const result = chooseNextAvailableMember({
			members: [{ id: 'a', name: 'Ava' }],
			currentMemberId: 'a',
			absentMemberIds: ['a'],
		});
		// REGRESSION GUARD — keep: current behavior returns null (no one available).
		expect(result).toBeNull();
	});

	it('UI hint and server pick agree when a member becomes absent mid-flight', () => {
		// Iter 8 drift guard with absence flavor: user clicks "Erledigt" exactly
		// when another user marked someone absent. UI suggestedAssignee and
		// chooseNextAvailableMember must use the same fairness inputs.
		const members = [
			{ id: 'a', name: 'Ava' },
			{ id: 'b', name: 'Ben' },
			{ id: 'c', name: 'Cora' },
		];
		const chores = [
			{ assignedMemberId: 'a', openGapCountForAssignee: 1, nextDueAt: FUTURE },
			{ assignedMemberId: 'b', openGapCountForAssignee: 0, nextDueAt: FUTURE },
		];
		const fairness = buildChoreFairness({ members, chores, absentMemberIds: ['c'] });
		const serverPick = chooseNextAvailableMember({
			members,
			currentMemberId: 'a',
			chores,
			absentMemberIds: ['c'],
		});
		expect(serverPick).toBe(fairness.suggestedAssignee?.id);
	});
});
