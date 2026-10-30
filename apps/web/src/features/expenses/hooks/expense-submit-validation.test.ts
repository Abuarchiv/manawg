import assert from 'node:assert/strict';
import test from 'node:test';
import { oldestExpenseDay, validateExpenseFields } from './expense-submit-validation';

const now = new Date(2026, 9, 30, 12);
const fields = (occurredOn: string) => ({
	description: 'Brot',
	amountEuros: 5,
	amountText: '5',
	occurredOn,
});

test('a newly picked day older than the API accepts is a date error', () => {
	assert.equal(oldestExpenseDay(now), '2021-11-01');
	assert.deepEqual(validateExpenseFields(fields('0026-11-05'), null, now).date, {
		key: 'expenses-form.validation.date',
	});
	assert.equal(
		validateExpenseFields(fields('2021-10-31'), null, now).date?.key,
		'expenses-form.validation.date',
	);
	assert.equal(validateExpenseFields(fields('2021-11-01'), null, now).date, undefined);
	assert.equal(validateExpenseFields(fields('2026-10-30'), null, now).date, undefined);
});

test('an edited expense keeps its stored day even when it is older than the bound', () => {
	assert.equal(validateExpenseFields(fields('2020-03-01'), '2020-03-01', now).date, undefined);
	assert.equal(
		validateExpenseFields(fields('2020-03-02'), '2020-03-01', now).date?.key,
		'expenses-form.validation.date',
	);
});

test('a day after today stays a date error', () => {
	assert.equal(
		validateExpenseFields(fields('2026-10-31'), null, now).date?.key,
		'expenses-form.validation.date',
	);
});
