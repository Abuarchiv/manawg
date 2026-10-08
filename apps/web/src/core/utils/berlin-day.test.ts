import assert from 'node:assert/strict';
import test from 'node:test';

const { berlinCalendarDayDistance } = await import('./berlin-day');

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
