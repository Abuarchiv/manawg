import assert from 'node:assert/strict';
import test from 'node:test';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { displayedDayAsInstant, resolveOccurredAt } from '@/features/expenses/expense-occurred-at';

const today = berlinDayKey(new Date());

test('an empty or unchanged date sends nothing', () => {
	assert.deepEqual(resolveOccurredAt('', null), { iso: null, invalid: false });
	assert.deepEqual(resolveOccurredAt(today, null), { iso: null, invalid: false });
	assert.deepEqual(resolveOccurredAt('2026-03-05', '2026-03-05T11:00:00.000Z'), {
		iso: null,
		invalid: false,
	});
});

test('a different day becomes noon Berlin time', () => {
	const winter = resolveOccurredAt('2026-01-15', null);
	assert.equal(winter.invalid, false);
	assert.equal(winter.iso, '2026-01-15T11:00:00.000Z');
	const summer = resolveOccurredAt('2026-07-15', null);
	assert.equal(summer.iso, '2026-07-15T10:00:00.000Z');
});

test('a date that is not a day is reported', () => {
	assert.deepEqual(resolveOccurredAt('2026-13-45', null), { iso: null, invalid: true });
});

test('editing compares against the expense day, not today', () => {
	assert.equal(resolveOccurredAt(today, '2026-01-15T11:00:00.000Z').iso !== null, true);
});

test('a queued create keeps the displayed day as its booking day', () => {
	assert.equal(displayedDayAsInstant('2026-01-15'), '2026-01-15T11:00:00.000Z');
	assert.equal(displayedDayAsInstant('2026-07-15'), '2026-07-15T10:00:00.000Z');
	// An empty field means today in Berlin: noon of that day, not the replay instant.
	assert.equal(displayedDayAsInstant(''), displayedDayAsInstant(today));
});
