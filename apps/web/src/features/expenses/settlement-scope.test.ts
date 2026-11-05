import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNetBalances } from './debt-reduction';
import {
	parseSettlementConfirmation,
	type SettlementExpenseInput,
	selectSettlementScope,
	settlementScopeMatches,
} from './settlement-scope';

const ANNA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CEM = '33333333-3333-4333-8333-333333333333';
const members = [
	{ id: ANNA, name: 'Anna', color: null },
	{ id: BEN, name: 'Ben', color: null },
];

function expense(
	id: string,
	paidBy: string,
	debtor: string,
	amounts: number[],
	occurredAt: string,
): SettlementExpenseInput {
	return {
		id,
		paidByMemberId: paidBy,
		occurredAt,
		splits: amounts.map((amountCents, index) => ({
			id: `${id}-${index}`,
			expenseId: id,
			debtorMemberId: debtor,
			amountCents,
			settledAt: null,
		})),
	};
}

// Ben owes Anna 42,95 (Anna paid), Anna owes Ben 38,52 (Ben paid): nets to 4,43.
const mutual = [
	expense('e1', ANNA, BEN, [4295], '2026-09-01T10:00:00.000Z'),
	expense('e2', BEN, ANNA, [3852], '2026-09-02T10:00:00.000Z'),
];

test('mutual expenses settle as one pair when no single split fits the net amount', () => {
	const scope = selectSettlementScope(mutual, members, [], BEN, ANNA);
	assert.equal(scope.netCents, 443);
	assert.equal(scope.settleableCents, 443);
	assert.equal(scope.remainingCents, 0);
	assert.equal(scope.reason, undefined);
	assert.deepEqual(
		scope.splits.map((s) => [s.id, s.offset ?? false]),
		[
			['e1-0', false],
			['e2-0', true],
		],
	);
});

test('pair settlement never touches splits that involve a third member', () => {
	const threeMembers = [...members, { id: CEM, name: 'Cem', color: null }];
	// The third-member splits form a cycle through Cem, so the Ben to Anna net stays 4,43.
	const expenses = [
		...mutual,
		expense('e3', CEM, BEN, [1000], '2026-09-03T10:00:00.000Z'),
		expense('e4', ANNA, CEM, [1000], '2026-09-04T10:00:00.000Z'),
		expense('e5', CEM, ANNA, [1000], '2026-09-05T10:00:00.000Z'),
		expense('e6', BEN, CEM, [1000], '2026-09-06T10:00:00.000Z'),
	];
	const scope = selectSettlementScope(expenses, threeMembers, [], BEN, ANNA);
	assert.equal(scope.netCents, 443);
	assert.deepEqual(
		scope.splits.map((s) => s.id),
		['e1-0', 'e2-0'],
	);
});

test('settling both directions brings the pair balance to zero', () => {
	const scope = selectSettlementScope(mutual, members, [], BEN, ANNA);
	const ids = new Set(scope.splits.map((s) => s.id));
	const after = mutual.map((e) => ({
		paidByMemberId: e.paidByMemberId,
		currency: 'EUR',
		splits: e.splits.map((s) => ({
			debtorMemberId: s.debtorMemberId,
			amountCents: s.amountCents,
			settledAt: ids.has(s.id) ? '2026-09-03T00:00:00.000Z' : null,
		})),
	}));
	assert.ok(computeNetBalances(after, members, []).every((b) => b.cents === 0));
});

test('pair settlement wins over a small greedy match', () => {
	const expenses = [
		expense('e1', ANNA, BEN, [100, 4295], '2026-09-01T10:00:00.000Z'),
		expense('e2', BEN, ANNA, [3852], '2026-09-02T10:00:00.000Z'),
	];
	const scope = selectSettlementScope(expenses, members, [], BEN, ANNA);
	assert.equal(scope.netCents, 543);
	assert.equal(scope.settleableCents, 543);
	assert.equal(scope.splits.length, 3);
});

test('a recorded payment keeps the pair settlement out', () => {
	const payments = [{ fromMemberId: BEN, toMemberId: ANNA, amountCents: 100, currency: 'EUR' }];
	const scope = selectSettlementScope(mutual, members, payments, BEN, ANNA);
	assert.equal(scope.netCents, 343);
	assert.equal(scope.settleableCents, 0);
	assert.equal(scope.reason, 'no_direct_splits');
});

test('the offset flag is part of the confirmation contract', () => {
	const scope = selectSettlementScope(mutual, members, [], BEN, ANNA);
	const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
	const review = {
		fromMemberId: BEN,
		toMemberId: ANNA,
		expected: {
			netCents: 443,
			settleableCents: 443,
			splits: [
				{ id: uuid(1), amountCents: 4295 },
				{ id: uuid(2), amountCents: 3852, offset: true },
			],
		},
	};
	const parsed = parseSettlementConfirmation(review);
	assert.ok(parsed.ok);
	if (parsed.ok) assert.equal(parsed.value.expected.splits[0]?.offset, false);
	// Counting the counter-claim as a normal split breaks the total.
	review.expected.splits[1] = { id: uuid(2), amountCents: 3852 };
	assert.equal(parseSettlementConfirmation(review).ok, false);

	const matching = {
		netCents: 443,
		settleableCents: 443,
		splits: scope.splits.map((s) => ({ id: s.id, amountCents: s.amountCents, offset: !!s.offset })),
	};
	assert.ok(settlementScopeMatches(matching, scope));
	matching.splits[1] = { ...matching.splits[1], offset: false } as (typeof matching.splits)[number];
	assert.equal(settlementScopeMatches(matching, scope), false);
});

test('splits of the same moment keep one order, whatever order the database returns', () => {
	const at = '2026-09-01T10:00:00.000Z';
	const a = expense('a', ANNA, BEN, [300], at);
	const b = expense('b', ANNA, BEN, [200], at);
	const forward = selectSettlementScope([a, b], members, [], BEN, ANNA);
	const backward = selectSettlementScope([b, a], members, [], BEN, ANNA);
	assert.deepEqual(
		backward.splits.map((s) => s.id),
		['a-0', 'b-0'],
	);
	assert.ok(settlementScopeMatches(forward, backward));
});

test('a share of zero is never part of a settlement', () => {
	const scope = selectSettlementScope(
		[expense('e1', ANNA, BEN, [0, 500], '2026-09-01T10:00:00.000Z')],
		members,
		[],
		BEN,
		ANNA,
	);
	assert.deepEqual(
		scope.splits.map((s) => s.id),
		['e1-1'],
	);
});

test('a settled-up pair has an empty scope without a reason', () => {
	const scope = selectSettlementScope(
		[
			expense('e1', ANNA, BEN, [500], '2026-09-01T10:00:00.000Z'),
			expense('e2', BEN, ANNA, [500], '2026-09-02T10:00:00.000Z'),
		],
		members,
		[],
		BEN,
		ANNA,
	);
	assert.deepEqual(scope, {
		currency: 'EUR',
		netCents: 0,
		settleableCents: 0,
		remainingCents: 0,
		splits: [],
	});
});

test('direct splits win when they settle as much as the pair would', () => {
	const expenses = [
		expense('e1', ANNA, BEN, [1000, 500], '2026-09-01T10:00:00.000Z'),
		expense('e2', BEN, ANNA, [500], '2026-09-02T10:00:00.000Z'),
	];
	const scope = selectSettlementScope(expenses, members, [], BEN, ANNA);
	assert.equal(scope.settleableCents, 1000);
	assert.deepEqual(
		scope.splits.map((s) => [s.id, s.offset ?? false]),
		[['e1-0', false]],
	);
});

test('a review in another currency does not confirm the scope', () => {
	const scope = selectSettlementScope(mutual, members, [], BEN, ANNA);
	assert.ok(settlementScopeMatches({ ...scope, currency: 'EUR' }, scope));
	assert.equal(settlementScopeMatches({ ...scope, currency: 'CHF' }, scope), false);
});

test('a review that settles more than the net debt is rejected', () => {
	const uuid = '00000000-0000-4000-8000-000000000001';
	const parsed = parseSettlementConfirmation({
		fromMemberId: BEN,
		toMemberId: ANNA,
		expected: {
			netCents: 100,
			settleableCents: 200,
			splits: [{ id: uuid, amountCents: 200 }],
		},
	});
	assert.deepEqual(parsed, { ok: false, reason: 'invalid' });
});
