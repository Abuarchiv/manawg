import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense } from './expense-types';

const { buildOptimisticExpense, rollbackExpense, sortExpensesNewestFirst } = await import(
	'./optimistic-expense'
);

const loaded: Expense = {
	id: 'e1',
	paidByMemberId: 'anna',
	amountCents: 3000,
	currency: 'CHF',
	description: 'Pizza',
	category: 'food',
	imageUrl: null,
	occurredAt: '2026-10-01T12:00:00.000Z',
	createdAt: '2026-10-01T13:00:00.000Z',
	updatedAt: '2026-10-02T09:00:00.000Z',
	splits: [
		{
			id: 's-ben',
			debtorMemberId: 'ben',
			amountCents: 1500,
			settledAt: '2026-10-03T10:00:00.000Z',
		},
		{
			id: 's-cem',
			debtorMemberId: 'cem',
			amountCents: 1500,
			settledAt: '2026-10-03T10:00:00.000Z',
		},
	],
};

test('an edited expense keeps its server fields and the settled state of unchanged shares', () => {
	const edited = buildOptimisticExpense({
		id: 'e1',
		description: 'Pizza und Getränke',
		category: 'food',
		amountCents: 3500,
		paidByMemberId: 'anna',
		imageUrl: null,
		splits: [
			{ debtorMemberId: 'ben', amountCents: 1500 },
			{ debtorMemberId: 'cem', amountCents: 2000 },
			{ debtorMemberId: 'dana', amountCents: 0 },
		],
		previous: loaded,
	});
	assert.equal(edited.currency, 'CHF');
	assert.equal(edited.occurredAt, loaded.occurredAt);
	assert.equal(edited.createdAt, loaded.createdAt);
	assert.equal(edited.updatedAt, loaded.updatedAt);
	assert.deepEqual(edited.splits, [
		{
			id: 's-ben',
			debtorMemberId: 'ben',
			amountCents: 1500,
			settledAt: '2026-10-03T10:00:00.000Z',
		},
		// A changed amount reopens the share.
		{ id: 's-cem', debtorMemberId: 'cem', amountCents: 2000, settledAt: null },
		{ id: 'e1:split:2', debtorMemberId: 'dana', amountCents: 0, settledAt: null },
	]);
});

test('a new expense is in euros, open, and dated by the form or now', () => {
	const before = Date.now();
	const created = buildOptimisticExpense({
		id: 'tmp-1',
		description: 'Brot',
		category: 'food',
		amountCents: 300,
		paidByMemberId: 'anna',
		imageUrl: null,
		splits: [{ debtorMemberId: 'ben', amountCents: 150 }],
	});
	assert.equal(created.currency, 'EUR');
	assert.ok(Date.parse(created.occurredAt) >= before);
	assert.equal(created.createdAt, created.updatedAt);
	assert.deepEqual(created.splits, [
		{ id: 'tmp-1:split:0', debtorMemberId: 'ben', amountCents: 150, settledAt: null },
	]);
	const dated = buildOptimisticExpense({
		...{ id: 'tmp-2', description: 'Brot', category: 'food' as const, amountCents: 300 },
		...{ paidByMemberId: 'anna', imageUrl: null, splits: [] },
		occurredAt: '2026-09-01T12:00:00.000Z',
		previous: loaded,
	});
	assert.equal(dated.occurredAt, '2026-09-01T12:00:00.000Z');
});

test('the list sorts by day, then entry time, then id, newest first', () => {
	const row = (id: string, occurredAt: string, createdAt: string) =>
		({ ...loaded, id, occurredAt, createdAt }) as Expense;
	const sorted = sortExpensesNewestFirst([
		row('z', '2026-10-01T12:00:00.000Z', '2026-10-01T08:00:00.000Z'),
		row('b', '2026-10-01T12:00:00.000Z', '2026-10-01T09:00:00.000Z'),
		row('c', '2026-10-02T12:00:00.000Z', '2026-10-01T07:00:00.000Z'),
		row('d', '2026-10-01T12:00:00.000Z', '2026-10-01T09:00:00.000Z'),
		row('x', 'kaputt', '2026-10-01T10:00:00.000Z'),
	]);
	assert.deepEqual(
		sorted.map((expense) => expense.id),
		['c', 'd', 'b', 'z', 'x'],
	);
});

test('a rollback drops a new row and restores an edited one in place or on top', () => {
	const other = { ...loaded, id: 'e2' };
	const optimistic = { ...loaded, description: 'Neu' };
	assert.deepEqual(rollbackExpense([optimistic, other], 'tmp-1', null), [optimistic, other]);
	assert.deepEqual(rollbackExpense([{ ...loaded, id: 'tmp-1' }, other], 'tmp-1', null), [other]);
	assert.deepEqual(rollbackExpense([other, optimistic], 'e1', loaded), [other, loaded]);
	assert.deepEqual(rollbackExpense([other], 'e1', loaded), [loaded, other]);
});
