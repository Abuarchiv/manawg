import assert from 'node:assert/strict';
import test from 'node:test';

const { formatChoreCadence } = await import('./chore-cadence');

test('a named rhythm supplies its own message', () => {
	assert.deepEqual(formatChoreCadence(7, 'days'), { key: 'chores.cadence.weekly' });
	assert.deepEqual(formatChoreCadence(3, 'months'), { key: 'chores.cadence.quarterly' });
});

test('any other interval falls back to a count with its unit', () => {
	assert.deepEqual(formatChoreCadence(14, 'days'), {
		key: 'chores.cadence.everyDays',
		values: { count: 14 },
	});
	assert.deepEqual(formatChoreCadence(2, 'months'), {
		key: 'chores.cadence.everyMonths',
		values: { count: 2 },
	});
});

test('a zero interval is a one-off chore', () => {
	assert.deepEqual(formatChoreCadence(0, 'days'), { key: 'chores.cadence.oneOff' });
});
