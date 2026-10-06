// Settlement scope and debt overview: which direct splits a settlement covers, stale-review
// rejection, and how personal transfers are separated from other residents.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getDebtOverview } from '../src/features/expenses/debt-overview';
import {
	buildSettlementSummary,
	computeDirectDebts,
} from '../src/features/expenses/debt-reduction';
import {
	type SettlementExpenseInput,
	type SettlementMemberInput,
	parseSettlementConfirmation,
	selectSettlementScope,
	settlementScopeMatches,
} from '../src/features/expenses/settlement-scope';

describe('settlement scope', () => {
	const memberA = '11111111-1111-4111-8111-111111111111';
	const memberB = '22222222-2222-4222-8222-222222222222';
	const memberC = '33333333-3333-4333-8333-333333333333';

	const members: SettlementMemberInput[] = [
		{ id: memberA, name: 'Anna', color: null },
		{ id: memberB, name: 'Ben', color: null },
		{ id: memberC, name: 'Cem', color: null },
	];

	function expense(
		id: string,
		paidByMemberId: string,
		occurredAt: string,
		debtors: Array<{ id: string; amountCents: number }>,
	): SettlementExpenseInput {
		return {
			id,
			paidByMemberId,
			occurredAt,
			splits: debtors.map(({ id: debtorMemberId, amountCents }) => ({
				id: `${id}-split-${debtorMemberId.slice(0, 4)}`,
				expenseId: id,
				debtorMemberId,
				amountCents,
				settledAt: null,
			})),
		};
	}

	describe('Settlement scope', () => {
		test('selects every exact direct split oldest first and ignores other pairs', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 700 },
					]),
					expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
						{ id: memberB, amountCents: 900 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			assert.deepEqual(actual, {
				currency: 'EUR',
				netCents: 1200,
				settleableCents: 1200,
				remainingCents: 0,
				splits: [
					{ id: 'expense-old-split-2222', expenseId: 'expense-old', amountCents: 700 },
					{ id: 'expense-new-split-2222', expenseId: 'expense-new', amountCents: 500 },
				],
			});
		});

		test('reports a partial scope when net debt exceeds whole direct splits', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-direct', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 1000 },
					]),
					expense('expense-through-cem', memberC, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-cem-to-anna', memberA, '2026-09-03T10:00:00.000Z', [
						{ id: memberC, amountCents: 1000 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			assert.deepEqual(actual, {
				currency: 'EUR',
				netCents: 1500,
				settleableCents: 1000,
				remainingCents: 500,
				splits: [
					{ id: 'expense-direct-split-2222', expenseId: 'expense-direct', amountCents: 1000 },
				],
			});
		});

		test('caps a 51-split scope and selects the remaining split on the follow-up', () => {
			const expenses = Array.from({ length: 51 }, (_, index) =>
				expense(`expense-${String(index).padStart(2, '0')}`, memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 1 },
				]),
			);

			const firstScope = selectSettlementScope(expenses, members, [], memberB, memberA);

			assert.equal(firstScope.splits.length, 50);
			assert.equal(firstScope.settleableCents, 50);
			assert.equal(firstScope.remainingCents, 1);

			const firstSplitIds = new Set(firstScope.splits.map((split) => split.id));
			const followUpScope = selectSettlementScope(
				expenses.map((currentExpense) => ({
					...currentExpense,
					splits: currentExpense.splits.map((split) => ({
						...split,
						settledAt: firstSplitIds.has(split.id) ? '2026-09-02T10:00:00.000Z' : split.settledAt,
					})),
				})),
				members,
				[],
				memberB,
				memberA,
			);

			assert.deepEqual(followUpScope, {
				currency: 'EUR',
				netCents: 1,
				settleableCents: 1,
				remainingCents: 0,
				splits: [{ id: 'expense-50-split-2222', expenseId: 'expense-50', amountCents: 1 }],
			});
		});

		test('reports a net-only debt when no direct split exists', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-ben-to-cem', memberC, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 1000 },
					]),
					expense('expense-cem-to-anna', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberC, amountCents: 1000 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);

			assert.deepEqual(actual, {
				currency: 'EUR',
				netCents: 1000,
				settleableCents: 0,
				remainingCents: 1000,
				splits: [],
				reason: 'no_direct_splits',
			});
		});

		test('rejects stale net, record ids, and record amounts', () => {
			const actual = selectSettlementScope(
				[
					expense('expense-old', memberA, '2026-09-01T10:00:00.000Z', [
						{ id: memberB, amountCents: 700 },
					]),
					expense('expense-new', memberA, '2026-09-02T10:00:00.000Z', [
						{ id: memberB, amountCents: 500 },
					]),
					expense('expense-other-pair', memberC, '2026-09-03T10:00:00.000Z', [
						{ id: memberB, amountCents: 900 },
					]),
				],
				members,
				[],
				memberB,
				memberA,
			);
			const reviewed = {
				netCents: 1200,
				settleableCents: 1200,
				splits: [
					{ id: 'expense-old-split-2222', amountCents: 700 },
					{ id: 'expense-new-split-2222', amountCents: 500 },
				],
			};

			assert.equal(settlementScopeMatches(reviewed, actual), true);
			assert.equal(settlementScopeMatches({ ...reviewed, netCents: 1100 }, actual), false);
			assert.equal(
				settlementScopeMatches(
					{
						...reviewed,
						splits: [
							{ id: 'different-split', amountCents: 700 },
							{ id: 'expense-new-split-2222', amountCents: 500 },
						],
					},
					actual,
				),
				false,
			);
			assert.equal(
				settlementScopeMatches(
					{
						...reviewed,
						splits: [
							{ id: 'expense-old-split-2222', amountCents: 600 },
							{ id: 'expense-new-split-2222', amountCents: 600 },
						],
					},
					actual,
				),
				false,
			);
		});

		test('rejects a retry using the review from before its splits were settled', () => {
			const reviewedExpenses = [
				expense('expense-first', memberA, '2026-09-01T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
				expense('expense-second', memberA, '2026-09-02T10:00:00.000Z', [
					{ id: memberB, amountCents: 500 },
				]),
			];
			const preview = selectSettlementScope(reviewedExpenses, members, [], memberB, memberA);
			const expected = {
				currency: preview.currency,
				netCents: preview.netCents,
				settleableCents: preview.settleableCents,
				splits: preview.splits.map(({ id, amountCents }) => ({ id, amountCents })),
			};
			const afterFirstCommit = reviewedExpenses.map((current) => ({
				...current,
				splits: current.splits.map((split) => ({
					...split,
					settledAt: new Date('2026-09-03T10:00:00.000Z'),
				})),
			}));
			const retry = selectSettlementScope(afterFirstCommit, members, [], memberB, memberA);

			assert.equal(preview.splits.length, 2);
			assert.deepEqual(retry.splits, []);
			assert.equal(settlementScopeMatches(expected, retry), false);
		});

		test('requires a complete strict review and rejects duplicate or invalid records', () => {
			const validReview = {
				fromMemberId: memberB,
				toMemberId: memberA,
				currency: 'EUR',
				expected: {
					currency: 'EUR',
					netCents: 1000,
					settleableCents: 1000,
					splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: 1000 }],
				},
			};
			assert.deepEqual(parseSettlementConfirmation(validReview), { ok: true, value: validReview });

			assert.deepEqual(
				parseSettlementConfirmation({ fromMemberId: memberB, toMemberId: memberA }),
				{
					ok: false,
					reason: 'required',
				},
			);

			assert.deepEqual(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 1000,
						splits: [
							{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
							{ id: '44444444-4444-4444-8444-444444444444', amountCents: 500 },
						],
					},
				}),
				{ ok: false, reason: 'invalid' },
			);

			assert.deepEqual(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 500,
						splits: [{ id: '44444444-4444-4444-8444-444444444444', amountCents: -1 }],
					},
				}),
				{ ok: false, reason: 'invalid' },
			);

			assert.deepEqual(
				parseSettlementConfirmation({
					fromMemberId: memberB,
					toMemberId: memberA,
					expected: {
						netCents: 1000,
						settleableCents: 1000,
						splits: [],
					},
					extra: 'not-supported',
				}),
				{ ok: false, reason: 'invalid' },
			);
		});
	});
});

describe('debt overview', () => {
	const outgoing = { fromId: 'me', fromName: 'Alex', toId: 'lisa', toName: 'Lisa', cents: 1200 };
	const incoming = { fromId: 'lisa', fromName: 'Lisa', toId: 'me', toName: 'Alex', cents: 1200 };
	const other = { fromId: 'ben', fromName: 'Ben', toId: 'sara', toName: 'Sara', cents: 2500 };

	test('reciprocal open expenses cancel without resurfacing as transfer demands', () => {
		const members = [
			{ id: 'me', name: 'Alex', color: null },
			{ id: 'lisa', name: 'Lisa', color: null },
		];
		const expenses = [
			{
				paidByMemberId: 'me',
				splits: [{ debtorMemberId: 'lisa', amountCents: 1200, settledAt: null }],
			},
			{
				paidByMemberId: 'lisa',
				splits: [{ debtorMemberId: 'me', amountCents: 1200, settledAt: null }],
			},
		];
		const summary = buildSettlementSummary(expenses, members);
		assert.deepEqual(getDebtOverview(computeDirectDebts(expenses, members), 'me', summary), {
			personal: [],
			others: [],
		});
		assert.equal(
			expenses.every((expense) => expense.splits[0]?.settledAt === null),
			true,
		);
	});

	test('incoming and outgoing personal transfers are separated from other residents', () => {
		assert.deepEqual(getDebtOverview([other, outgoing, incoming], 'me'), {
			personal: [outgoing, incoming],
			others: [other],
		});
	});

	test('uninvolved residents have no personal demand', () => {
		assert.deepEqual(getDebtOverview([other], 'me'), { personal: [], others: [other] });
	});

	test('a provided simplified result is authoritative even without direct debts', () => {
		assert.deepEqual(
			getDebtOverview([], 'me', {
				directCount: 0,
				simplifiedCount: 1,
				savedTransfers: 0,
				totalOpenCents: 1200,
				simplified: [outgoing],
			}).personal,
			[outgoing],
		);
	});
});
