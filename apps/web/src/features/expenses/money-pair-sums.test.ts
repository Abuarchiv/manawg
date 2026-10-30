import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSettlementSummary } from './debt-reduction';
import { aggregatePairTotals } from './debts';
import { buildEqualSplits } from './split-math';

const members = [
	{ id: 'A', name: 'Ada', color: null },
	{ id: 'B', name: 'Ben', color: null },
	{ id: 'C', name: 'Cem', color: null },
];

function expense(paidByMemberId: string, debtorMemberId: string, amountCents: number) {
	return {
		paidByMemberId,
		currency: 'EUR',
		splits: [{ debtorMemberId, amountCents, settledAt: null }],
	};
}

test('aggregatePairTotals adds the open splits of one debtor and creditor pair', () => {
	const totals = aggregatePairTotals([
		expense('B', 'A', 300),
		expense('C', 'A', 700),
		expense('B', 'A', 450),
	]);
	assert.equal(totals.size, 2);
	assert.equal(totals.get('EUR:A:B')?.amountCents, 750);
	assert.equal(totals.get('EUR:A:C')?.amountCents, 700);
});

test('buildSettlementSummary sums every open direct debt', () => {
	const summary = buildSettlementSummary(
		[expense('B', 'A', 300), expense('C', 'A', 450), expense('C', 'B', 100)],
		members,
	);
	assert.equal(summary.totalOpenCents, 850);
	assert.deepEqual(summary.totalOpenByCurrency, { EUR: 850 });
});

test('buildSettlementSummary counts the transfers a chain of debts saves', () => {
	// A owes B and B owes C the same amount: two direct transfers, one simplified.
	const summary = buildSettlementSummary([expense('B', 'A', 300), expense('C', 'B', 300)], members);
	assert.equal(summary.directCount, 2);
	assert.equal(summary.simplifiedCount, 1);
	assert.equal(summary.savedTransfers, 1);
});

test('buildEqualSplits gives the leftover cent to the first debtor after rotation', () => {
	const ids = ['x', 'y', 'z'];
	assert.deepEqual(buildEqualSplits(1, ids, 1), [
		{ debtorMemberId: 'y', amountCents: 1 },
		{ debtorMemberId: 'z', amountCents: 0 },
		{ debtorMemberId: 'x', amountCents: 0 },
	]);
	assert.deepEqual(buildEqualSplits(1, ids, -1), [
		{ debtorMemberId: 'z', amountCents: 1 },
		{ debtorMemberId: 'x', amountCents: 0 },
		{ debtorMemberId: 'y', amountCents: 0 },
	]);
});
