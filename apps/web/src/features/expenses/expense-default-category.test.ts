import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExpenseCategory, resolveDefaultCategory } from './expense-default-category';

const expenses = [
	{ description: 'Milch', category: 'groceries', paidByMemberId: 'me' },
	{ description: 'milch ', category: 'other', paidByMemberId: 'me' },
	{ description: 'Putzmittel', category: 'household', paidByMemberId: 'other' },
	{ description: 'Strom', category: 'housing', paidByMemberId: 'me' },
] as const;

const resolve = (description: string, lastCategory: 'leisure' | null = null) =>
	resolveDefaultCategory({ description, expenses, memberId: 'me', lastCategory });

test('uses the category of the latest own expense with an equal description', () => {
	assert.equal(resolve('Milch'), 'groceries');
	assert.equal(resolve('  MILCH  '), 'groceries');
	assert.equal(resolve('Strom', 'leisure'), 'housing');
});

test('ignores expenses paid by someone else', () => {
	assert.equal(resolve('Putzmittel'), 'other');
	assert.equal(resolve('Putzmittel', 'leisure'), 'leisure');
});

test('falls back to the last used category, then to other', () => {
	assert.equal(resolve('Kino', 'leisure'), 'leisure');
	assert.equal(resolve('', 'leisure'), 'leisure');
	assert.equal(resolve('Kino'), 'other');
	assert.equal(resolve('   '), 'other');
});

test('parseExpenseCategory accepts only known codes', () => {
	assert.equal(parseExpenseCategory('transport'), 'transport');
	assert.equal(parseExpenseCategory('rent'), null);
	assert.equal(parseExpenseCategory(undefined), null);
});
