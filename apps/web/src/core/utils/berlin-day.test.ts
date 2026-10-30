import assert from 'node:assert/strict';
import test from 'node:test';

const { berlinCalendarDayDistance, toBerlinDayKey } = await import('./berlin-day');

test('calendar day distance counts Berlin date changes, not 24h spans', () => {
	const morning = new Date('2026-10-05T06:00:00.000Z');
	assert.equal(berlinCalendarDayDistance(morning, new Date('2026-10-05T20:00:00.000Z')), 0);
	// 00:30 Berlin on the 6th is still the 5th in UTC.
	assert.equal(berlinCalendarDayDistance(morning, new Date('2026-10-05T22:30:00.000Z')), 1);
	assert.equal(berlinCalendarDayDistance(morning, new Date('2026-10-04T21:00:00.000Z')), -1);
});

test('calendar day distance stays whole across both DST switches', () => {
	assert.equal(
		berlinCalendarDayDistance(
			new Date('2026-03-28T12:00:00.000Z'),
			new Date('2026-03-30T12:00:00.000Z'),
		),
		2,
	);
	assert.equal(
		berlinCalendarDayDistance(
			new Date('2026-10-24T12:00:00.000Z'),
			new Date('2026-10-26T12:00:00.000Z'),
		),
		2,
	);
});

test('stored absence instants map back to their Berlin day, day keys pass through', () => {
	// Berlin midnight is 22:00Z (summer) / 23:00Z (winter) of the previous UTC day.
	assert.equal(toBerlinDayKey('2026-07-14T22:00:00.000Z'), '2026-07-15');
	assert.equal(toBerlinDayKey('2026-12-14T23:00:00.000Z'), '2026-12-15');
	assert.equal(toBerlinDayKey('2026-07-20T21:59:59.999Z'), '2026-07-20');
	assert.equal(toBerlinDayKey('2026-12-20T22:59:59.999Z'), '2026-12-20');
	assert.equal(toBerlinDayKey('2026-07-15'), '2026-07-15');
	assert.equal(toBerlinDayKey('not a date'), '');
});
