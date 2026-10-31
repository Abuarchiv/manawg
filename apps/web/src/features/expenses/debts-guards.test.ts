import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDirectDebts, computeNetBalances } from './debt-reduction';
import { aggregatePairTotals } from './debts';

const members = [
	{ id: 'A', name: 'A', color: null },
	{ id: 'B', name: 'B', color: null },
	{ id: 'C', name: 'C', color: null },
];

function split(debtorMemberId: string, amountCents: number, settledAt: string | null = null) {
	return { debtorMemberId, amountCents, settledAt };
}

function payment(fromMemberId: string, toMemberId: string, amountCents: number) {
	return { fromMemberId, toMemberId, amountCents, currency: 'EUR' };
}

function pairs(
	expenses: Parameters<typeof aggregatePairTotals>[0],
	payments: Parameters<typeof aggregatePairTotals>[1] = [],
) {
	return Array.from(aggregatePairTotals(expenses, payments).values());
}

const openOnly = [{ creditorId: 'A', debtorId: 'B', amountCents: 700, currency: 'EUR' }];

test('only the open split of an expense becomes a pair', () => {
	const expenses = [
		{
			paidByMemberId: 'A',
			currency: 'EUR',
			splits: [
				split('B', 300, '2026-09-01T00:00:00.000Z'),
				split('A', 400),
				split('C', 0),
				split('B', 700),
			],
		},
	];

	assert.deepEqual(pairs(expenses), openOnly);
	assert.deepEqual(
		computeDirectDebts(expenses, members).map(({ fromId, toId, cents }) => ({
			fromId,
			toId,
			cents,
		})),
		[{ fromId: 'B', toId: 'A', cents: 700 }],
	);
});

test('a zero or negative split adds no pair', () => {
	const expenses = [{ paidByMemberId: 'A', splits: [split('B', 0), split('C', -50)] }];

	assert.deepEqual(pairs(expenses), []);
});

test('zero, negative and self payments leave the pair totals unchanged', () => {
	const expenses = [{ paidByMemberId: 'A', currency: 'EUR', splits: [split('B', 700)] }];
	const payments = [payment('B', 'A', 0), payment('B', 'A', -200), payment('B', 'B', 100)];

	assert.deepEqual(pairs(expenses, payments), openOnly);
	assert.deepEqual(pairs([], payments), []);
});

test('an overpayment flips the direction of the pair', () => {
	const expenses = [{ paidByMemberId: 'A', currency: 'EUR', splits: [split('B', 700)] }];

	assert.deepEqual(
		pairs(expenses, [payment('B', 'A', 1000)]).filter((pair) => pair.amountCents > 0),
		[{ creditorId: 'B', debtorId: 'A', amountCents: 300, currency: 'EUR' }],
	);
});

test('a settled split and a departed member leave the net balances at zero without a departed balance', () => {
	const roster = members.slice(0, 2);
	const expenses = [
		{
			paidByMemberId: 'A',
			currency: 'EUR',
			splits: [
				split('B', 200),
				split('C', 500),
				split('A', 400),
				split('B', 300, '2026-09-01T00:00:00.000Z'),
			],
		},
		{ paidByMemberId: 'C', currency: 'EUR', splits: [split('A', 900), split('B', 100)] },
	];
	const payments = [payment('C', 'A', 300), payment('B', 'C', 400)];

	const balances = computeNetBalances(expenses, roster, payments);

	assert.deepEqual(balances.map((entry) => entry.memberId).sort(), ['A', 'B']);
	assert.deepEqual(
		balances.map((entry) => entry.cents),
		[200, -200],
	);
	assert.equal(
		balances.reduce((sum, entry) => sum + entry.cents, 0),
		0,
	);
});
