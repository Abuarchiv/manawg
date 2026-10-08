import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildSettlementSummary,
	computeDirectDebts,
	computeNetBalances,
	simplifyDebts,
} from './debt-reduction';
import { computeBalances } from './debts';

const members = [
	{ id: 'A', name: 'A', color: null },
	{ id: 'B', name: 'B', color: null },
];

function expense(
	paidByMemberId: string,
	debtorMemberId: string,
	amountCents: number,
	currency = 'EUR',
) {
	return {
		paidByMemberId,
		currency,
		occurredAt: '2026-09-27T00:00:00.000Z',
		splits: [{ debtorMemberId, amountCents, settledAt: null }],
	};
}

function payment(fromMemberId: string, toMemberId: string, amountCents: number, currency = 'EUR') {
	return { fromMemberId, toMemberId, amountCents, currency };
}

type DirectDebt = { fromId: string; toId: string; cents: number; currency?: string };
type PairDebt = { debtorId: string; creditorId: string; amountCents: number; currency: string };

function directRows(debts: DirectDebt[]) {
	return debts.map(({ fromId, toId, cents, currency }) => ({ fromId, toId, cents, currency }));
}

function pairRows(debts: PairDebt[]) {
	return debts.map(({ debtorId, creditorId, amountCents, currency }) => ({
		fromId: debtorId,
		toId: creditorId,
		cents: amountCents,
		currency,
	}));
}

function canonicalDebts(
	expenses: ReturnType<typeof expense>[],
	payments: ReturnType<typeof payment>[],
) {
	return directRows(simplifyDebts(computeNetBalances(expenses, members, payments)));
}

test('reducing an expense keeps its overpayment as debt in the reverse direction', () => {
	const expenses = [expense('A', 'B', 500)];
	const payments = [payment('B', 'A', 1000)];
	const expected = [{ fromId: 'A', toId: 'B', cents: 500, currency: 'EUR' }];

	assert.deepEqual(pairRows(computeBalances(expenses, payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts(expenses, members, payments)), expected);
	assert.deepEqual(canonicalDebts(expenses, payments), expected);
});

test('deleting an expense keeps the full payment as reverse debt', () => {
	const payments = [payment('B', 'A', 1000)];
	const expected = [{ fromId: 'A', toId: 'B', cents: 1000, currency: 'EUR' }];

	assert.deepEqual(pairRows(computeBalances([], payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts([], members, payments)), expected);
	assert.deepEqual(canonicalDebts([], payments), expected);
});

test('reverse residuals combine with existing debt without crossing currencies', () => {
	const expenses = [expense('A', 'B', 500), expense('B', 'A', 300)];
	const payments = [payment('B', 'A', 1000), payment('B', 'A', 1000, 'USD')];
	const expected = [
		{ fromId: 'A', toId: 'B', cents: 800, currency: 'EUR' },
		{ fromId: 'A', toId: 'B', cents: 1000, currency: 'USD' },
	];

	assert.deepEqual(pairRows(computeBalances(expenses, payments)), expected);
	assert.deepEqual(directRows(computeDirectDebts(expenses, members, payments)), expected);
	assert.deepEqual(canonicalDebts(expenses, payments), expected);
});

test('direct summaries preserve gross positive debts in both directions', () => {
	const expenses = [expense('B', 'A', 300), expense('A', 'B', 200)];
	const direct = [
		{ fromId: 'A', toId: 'B', cents: 300, currency: 'EUR' },
		{ fromId: 'B', toId: 'A', cents: 200, currency: 'EUR' },
	];

	assert.deepEqual(directRows(computeDirectDebts(expenses, members)), direct);
	assert.equal(buildSettlementSummary(expenses, members).directCount, 2);
	assert.deepEqual(pairRows(computeBalances(expenses)), [
		{ fromId: 'A', toId: 'B', cents: 100, currency: 'EUR' },
	]);
});

test('direct and net summaries ignore payments from departed members', () => {
	const historicalPayment = [payment('departed', 'A', 1000)];

	assert.deepEqual(computeDirectDebts([], members, historicalPayment), []);
	assert.deepEqual(canonicalDebts([], historicalPayment), []);
});
