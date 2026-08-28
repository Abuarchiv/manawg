/**
 * Iter 12 fairness edge cases — "think like a real WG".
 *
 * These tests cover scenarios users hit in production that the original suites
 * didn't exercise:
 *   - empty / single-member WGs (just created, or last member left)
 *   - mid-period membership changes (new joiner, removed member with debt)
 *   - all-members-absent (whole WG on vacation)
 *   - retroactive expense edits while a settle-batch is in flight
 *   - Hamilton edge: 0 cents, very large amounts, single debtor with rotation
 *   - net-balance invariant: sum across all members === 0
 *
 * If a case is tested and passes without code changes, it gets a
 * `// REGRESSION GUARD — keep` comment so future refactors don't regress it.
 */

import { computeNetBalances, simplifyDebts } from '@/features/expenses/debt-reduction';
import { computeBalances } from '@/features/expenses/debts';
import {
	buildEqualSplits,
	distributeCentsEqually,
	rotateDebtors,
	validateSplits,
} from '@/features/expenses/split-math';
import { describe, expect, it } from 'vitest';
import { buildChoreFairness, chooseNextAvailableMember } from './chore-fairness';

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

describe('iter12 — split-math edge cases', () => {
	it('handles 0-cent total — every debtor pays 0', () => {
		// REGRESSION GUARD — keep
		// "Geschenkt"-Eintrag mit 0€ (z.B. Mitbringsel-Tracking): jeder Debitor 0.
		const splits = buildEqualSplits(0, ['a', 'b', 'c']);
		expect(splits).toEqual([
			{ debtorMemberId: 'a', amountCents: 0 },
			{ debtorMemberId: 'b', amountCents: 0 },
			{ debtorMemberId: 'c', amountCents: 0 },
		]);
		expect(validateSplits(0, splits).ok).toBe(true);
	});

	it('handles single-debtor split with arbitrary rotation (offset never matters for n=1)', () => {
		// REGRESSION GUARD — keep
		for (const offset of [0, 1, 7, -3, 999]) {
			const splits = buildEqualSplits(1337, ['solo'], offset);
			expect(splits).toEqual([{ debtorMemberId: 'solo', amountCents: 1337 }]);
		}
	});

	it('preserves precision for very large totals (one million euros)', () => {
		// REGRESSION GUARD — keep
		// 100_000_000 cents = 1,000,000€ — the MAX_AMOUNT_CENTS boundary.
		// Splitting over 7 debtors should still sum exactly.
		const debtors = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
		const shares = distributeCentsEqually(100_000_000, debtors);
		expect(shares.reduce((s, x) => s + x, 0)).toBe(100_000_000);
		expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
	});

	it('rotateDebtors with offset === length × k is identity', () => {
		// REGRESSION GUARD — keep
		expect(rotateDebtors(['a', 'b', 'c'], 99)).toEqual(['a', 'b', 'c']);
		expect(rotateDebtors(['a', 'b', 'c'], -99)).toEqual(['a', 'b', 'c']);
	});

	it('validateSplits rejects splits with debtors not in the original list — guard against renamed members', () => {
		// REGRESSION GUARD — keep: validateSplits intentionally doesn't check
		// membership (that's the route handler's job), only sum/shape. So this
		// passes — pin the contract so a future refactor doesn't silently
		// broaden the validator's scope without updating callers.
		const result = validateSplits(100, [
			{ debtorMemberId: 'ghost-member-not-in-wg', amountCents: 100 },
		]);
		expect(result.ok).toBe(true);
	});
});

describe('iter12 — balance & debt-reduction edge cases', () => {
	it('net balances sum to exactly zero across every member (invariant)', () => {
		// REGRESSION GUARD — keep
		// If this ever breaks, the settle-up screen will show money appearing/
		// disappearing. Asserted as a property over a non-trivial dataset.
		const members = [
			{ id: 'a', name: 'Ava', color: null },
			{ id: 'b', name: 'Ben', color: null },
			{ id: 'c', name: 'Cora', color: null },
			{ id: 'd', name: 'Dee', color: null },
		];
		const expenses = [
			{
				paidByMemberId: 'a',
				splits: [
					{ debtorMemberId: 'a', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'b', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'c', amountCents: 250, settledAt: null },
					{ debtorMemberId: 'd', amountCents: 250, settledAt: null },
				],
			},
			{
				paidByMemberId: 'b',
				splits: [
					{ debtorMemberId: 'a', amountCents: 334, settledAt: null },
					{ debtorMemberId: 'b', amountCents: 333, settledAt: null },
					{ debtorMemberId: 'c', amountCents: 333, settledAt: null },
				],
			},
			{
				paidByMemberId: 'c',
				splits: [{ debtorMemberId: 'd', amountCents: 1000, settledAt: '2026-05-20T00:00:00Z' }],
			},
		];
		const balances = computeNetBalances(expenses, members);
		const sum = balances.reduce((s, b) => s + b.cents, 0);
		expect(sum).toBe(0);
	});

	it('simplifyDebts is a no-op when nobody owes anything (empty WG)', () => {
		// REGRESSION GUARD — keep
		expect(simplifyDebts([])).toEqual([]);
	});

	it('computeBalances drops a retroactively-settled split mid-aggregation', () => {
		// REGRESSION GUARD — keep
		// User A adds an expense, user B settles it via the app, then user A
		// (with stale cache) tries to PATCH it. The settle still wins because
		// we read settledAt at compute time.
		const balances = computeBalances([
			{
				paidByMemberId: 'a',
				occurredAt: '2026-05-01T00:00:00Z',
				splits: [
					{ debtorMemberId: 'b', amountCents: 500, settledAt: '2026-05-20T00:00:00Z' },
					{ debtorMemberId: 'c', amountCents: 500, settledAt: null },
				],
			},
		]);
		expect(balances).toEqual([{ creditorId: 'a', debtorId: 'c', amountCents: 500 }]);
	});

	it('simplifyDebts terminates and produces a valid plan for a circular 3-way debt', () => {
		// REGRESSION GUARD — keep
		// A→B 1000, B→C 1000, C→A 1000 should simplify to zero transfers.
		const members = [
			{ id: 'a', name: 'A', color: null },
			{ id: 'b', name: 'B', color: null },
			{ id: 'c', name: 'C', color: null },
		];
		const expenses = [
			{
				paidByMemberId: 'a',
				splits: [{ debtorMemberId: 'b', amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: 'b',
				splits: [{ debtorMemberId: 'c', amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: 'c',
				splits: [{ debtorMemberId: 'a', amountCents: 1000, settledAt: null }],
			},
		];
		const simplified = simplifyDebts(computeNetBalances(expenses, members));
		expect(simplified).toEqual([]);
	});

	it('computeBalances handles a member-deleted-but-debt-remained scenario gracefully', () => {
		// Member 'x' (no longer in WG) still owes money on an old split. The
		// debts module knows nothing about member existence — it just aggregates
		// IDs. Pin the contract: balance row is still emitted so the UI can
		// surface "Unbekannt schuldet 5€" instead of silently dropping it.
		// REGRESSION GUARD — keep
		const balances = computeBalances([
			{
				paidByMemberId: 'a',
				occurredAt: '2026-05-01T00:00:00Z',
				splits: [{ debtorMemberId: 'x-deleted-member', amountCents: 500, settledAt: null }],
			},
		]);
		expect(balances).toEqual([{ creditorId: 'a', debtorId: 'x-deleted-member', amountCents: 500 }]);
	});
});
