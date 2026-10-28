import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const expenses = { id: 'expenses.id' };
const expenseSplits = { expenseId: 'expense_splits.expense_id' };
const stored = { id: 'e1', description: 'Pizza', amountCents: 1200, occurredAt: new Date(0) };
const storedSplits = [
	{ debtorMemberId: 'b', amountCents: 600 },
	{ debtorMemberId: 'a', amountCents: 600 },
];

mock.module('@/core/db', {
	namedExports: {
		expenses,
		expenseSplits,
		db: {
			select: () => ({
				from: (table: unknown) => ({
					where: () =>
						Object.assign(Promise.resolve(table === expenseSplits ? storedSplits : [stored]), {
							limit: async () => [stored],
						}),
				}),
			}),
		},
	},
});
mock.module('drizzle-orm', { namedExports: { eq: () => null } });

const { storedExpenseHoldingEdit } = await import('./expense-held-edit');

test('an edit already in place answers with the stored expense and its splits', async () => {
	const held = await storedExpenseHoldingEdit(
		'e1',
		{ amountCents: 1200, occurredAt: new Date(0) },
		[
			{ debtorMemberId: 'a', amountCents: 600 },
			{ debtorMemberId: 'b', amountCents: 600 },
		],
	);
	assert.equal(held?.splits.length, 2);
});

test('another value or another split is not in place', async () => {
	assert.equal(await storedExpenseHoldingEdit('e1', { description: 'Sushi' }, undefined), null);
	const splits = [{ debtorMemberId: 'a', amountCents: 1200 }];
	assert.equal(await storedExpenseHoldingEdit('e1', {}, splits), null);
});
