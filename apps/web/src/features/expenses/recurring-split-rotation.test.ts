import assert from 'node:assert/strict';
import test from 'node:test';
import { rotateRemainderCents } from './recurring-split-rotation';

const splits = [
	{ debtorMemberId: 'a', amountCents: 3334 },
	{ debtorMemberId: 'b', amountCents: 3333 },
	{ debtorMemberId: 'c', amountCents: 3333 },
];
const amount = 10000;
const cents = (dueAt: string) =>
	rotateRemainderCents(splits, amount, new Date(dueAt), 1).map((split) => split.amountCents);

test('the extra cent moves to the next housemate each month', () => {
	assert.deepEqual(cents('2026-01-01T00:00:00Z'), [3334, 3333, 3333]);
	assert.deepEqual(cents('2026-02-01T00:00:00Z'), [3333, 3334, 3333]);
	assert.deepEqual(cents('2026-03-01T00:00:00Z'), [3333, 3333, 3334]);
	assert.deepEqual(cents('2026-04-01T00:00:00Z'), [3334, 3333, 3333]);
});

test('every booking still adds up to the amount', () => {
	for (let month = 0; month < 12; month += 1) {
		const total = rotateRemainderCents(
			splits,
			amount,
			new Date(Date.UTC(2026, month, 1)),
			1,
		).reduce((sum, split) => sum + split.amountCents, 0);
		assert.equal(total, amount);
	}
});

test('uneven custom splits and exact divisions stay as entered', () => {
	const custom = [
		{ debtorMemberId: 'a', amountCents: 7000 },
		{ debtorMemberId: 'b', amountCents: 3000 },
	];
	assert.deepEqual(
		rotateRemainderCents(custom, 10000, new Date('2026-02-01T00:00:00Z'), 1),
		custom,
	);
	const exact = [
		{ debtorMemberId: 'a', amountCents: 5000 },
		{ debtorMemberId: 'b', amountCents: 5000 },
	];
	assert.deepEqual(rotateRemainderCents(exact, 10000, new Date('2026-02-01T00:00:00Z'), 1), exact);
});

test('a quarterly template advances once per quarter', () => {
	const quarter = (dueAt: string) =>
		rotateRemainderCents(splits, amount, new Date(dueAt), 3).map((split) => split.amountCents);
	assert.deepEqual(quarter('2026-01-01T00:00:00Z'), quarter('2026-03-01T00:00:00Z'));
	assert.notDeepEqual(quarter('2026-01-01T00:00:00Z'), quarter('2026-04-01T00:00:00Z'));
});
