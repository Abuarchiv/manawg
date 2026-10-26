import assert from 'node:assert/strict';
import test from 'node:test';
import { computeOldestDebtAgeDays, computeOldestDebtAges } from './debts';

const now = new Date('2026-10-31T12:00:00Z');
const expense = (occurredAt: string, cents: number) => ({
	paidByMemberId: 'L',
	currency: 'EUR',
	occurredAt,
	splits: [{ debtorMemberId: 'J', amountCents: cents, settledAt: null }],
});
const expenses = [expense('2026-09-30T12:00:00Z', 1000), expense('2026-10-21T12:00:00Z', 500)];
const payment = (cents: number) => ({
	fromMemberId: 'J',
	toMemberId: 'L',
	amountCents: cents,
	currency: 'EUR',
});

test('a payment that covers the oldest split dates the debt from the next open one', () => {
	assert.equal(computeOldestDebtAgeDays('J', 'L', expenses, now), 31);
	assert.equal(computeOldestDebtAgeDays('J', 'L', expenses, now, 'EUR', [payment(1000)]), 10);
	// A partial payment leaves the oldest split open.
	assert.equal(computeOldestDebtAgeDays('J', 'L', expenses, now, 'EUR', [payment(999)]), 31);
	assert.deepEqual(
		computeOldestDebtAges([{ debtorId: 'J', creditorId: 'L' }], expenses, now, [payment(1500)]),
		[0],
	);
});
