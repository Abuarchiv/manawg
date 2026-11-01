import assert from 'node:assert/strict';
import test from 'node:test';
import { AMOUNT_MAX_CENTS, DESCRIPTION_MAX_LENGTH } from './expense-constants';
import { expenseAmountSchema, expenseDescriptionSchema, occurredAtSchema } from './expense-schemas';

const DAY_MS = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

test('occurredAt accepts today and past days within five years', () => {
	assert.equal(occurredAtSchema.safeParse(at(0)).success, true);
	assert.equal(occurredAtSchema.safeParse(at(-30 * DAY_MS)).success, true);
	assert.equal(occurredAtSchema.safeParse(at(-4 * 365 * DAY_MS)).success, true);
});

test('occurredAt rejects far future dates and dates older than five years', () => {
	assert.equal(occurredAtSchema.safeParse(at(3 * DAY_MS)).success, false);
	assert.equal(occurredAtSchema.safeParse(at(-6 * 365 * DAY_MS)).success, false);
	assert.equal(occurredAtSchema.safeParse('2026-13-40').success, false);
});

test('amount accepts the cap and rejects one cent above it', () => {
	assert.equal(expenseAmountSchema.safeParse(AMOUNT_MAX_CENTS).success, true);
	assert.equal(expenseAmountSchema.safeParse(AMOUNT_MAX_CENTS + 1).success, false);
});

test('description is trimmed and bounded', () => {
	assert.equal(expenseDescriptionSchema.parse('  Miete  '), 'Miete');
	assert.equal(expenseDescriptionSchema.safeParse('   ').success, false);
	assert.equal(
		expenseDescriptionSchema.safeParse('x'.repeat(DESCRIPTION_MAX_LENGTH)).success,
		true,
	);
	assert.equal(
		expenseDescriptionSchema.safeParse('x'.repeat(DESCRIPTION_MAX_LENGTH + 1)).success,
		false,
	);
});
