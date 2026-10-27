import assert from 'node:assert/strict';
import test from 'node:test';
import type { Expense } from './expense-types';

const { assembleExpensesResponse } = await import('./expense-list-response');

const expense = { id: 'e1' } as Expense;
const payment = { id: 'p1' } as never;

test('a changed list keeps the payments of the cached response', () => {
	const next = assembleExpensesResponse([expense], { expenses: [], payments: [payment] });
	assert.deepEqual(next.expenses, [expense]);
	assert.deepEqual(next.payments, [payment]);
});

test('without a cached response the payments start empty', () => {
	const next = assembleExpensesResponse([expense], undefined);
	assert.deepEqual(next, { expenses: [expense], payments: [] });
});
