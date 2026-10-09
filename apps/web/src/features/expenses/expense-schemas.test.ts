import assert from 'node:assert/strict';
import test from 'node:test';
import { expenseOccurredAtSchema } from './expense-schemas';

const yearsAgo = (years: number, extraDays = 0) => {
	const date = new Date();
	date.setUTCFullYear(date.getUTCFullYear() - years);
	date.setUTCDate(date.getUTCDate() + extraDays);
	return date.toISOString();
};

test('an expense dated exactly ten calendar years ago is accepted', () => {
	assert.equal(expenseOccurredAtSchema.safeParse(yearsAgo(10, 1)).success, true);
});

test('an expense older than ten calendar years is rejected', () => {
	assert.equal(expenseOccurredAtSchema.safeParse(yearsAgo(10, -2)).success, false);
});
