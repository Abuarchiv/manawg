import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecurrenceRule } from './event-recurrence-rule';
import { withShiftedExclusions } from './recurrence-shift';

test('moving a series start moves its removed occurrences by the same wall-time change', () => {
	// Weekly 10:00 Berlin, excluded April 10 (CEST); the series moves from March 27 to April 3.
	const rule = 'FREQ=WEEKLY;EXDATE=2026-04-10T08:00:00.000Z';
	const moved = parseRecurrenceRule(
		withShiftedExclusions(rule, '2026-03-27T09:00:00.000Z', '2026-04-03T08:00:00.000Z', false),
	);
	assert.deepEqual(moved?.exdates, ['2026-04-17T08:00:00.000Z']);
	const later = parseRecurrenceRule(
		withShiftedExclusions(rule, '2026-04-03T08:00:00.000Z', '2026-04-03T09:00:00.000Z', false),
	);
	assert.deepEqual(later?.exdates, ['2026-04-10T09:00:00.000Z']);
	const allDay = parseRecurrenceRule(
		withShiftedExclusions(
			'FREQ=DAILY;EXDATE=2026-04-10T00:00:00.000Z',
			'2026-04-01T00:00:00.000Z',
			'2026-04-03T00:00:00.000Z',
			true,
		),
	);
	assert.deepEqual(allDay?.exdates, ['2026-04-12T00:00:00.000Z']);
	assert.equal(
		withShiftedExclusions(
			'FREQ=DAILY',
			'2026-04-01T08:00:00.000Z',
			'2026-04-02T08:00:00.000Z',
			false,
		),
		'FREQ=DAILY',
	);
});

test('switching between timed and all-day keeps each exception on its calendar day', () => {
	// A summer 10:00 Berlin series with a winter (CET) exception becomes all-day, and back.
	const timed = 'FREQ=WEEKLY;EXDATE=2026-12-04T09:00:00.000Z';
	const toAllDay = parseRecurrenceRule(
		withShiftedExclusions(
			timed,
			'2026-06-05T08:00:00.000Z',
			'2026-06-05T00:00:00.000Z',
			true,
			false,
		),
	);
	assert.deepEqual(toAllDay?.exdates, ['2026-12-04T00:00:00.000Z']);
	const toTimed = parseRecurrenceRule(
		withShiftedExclusions(
			'FREQ=WEEKLY;EXDATE=2026-12-04T00:00:00.000Z',
			'2026-06-05T00:00:00.000Z',
			'2026-06-05T08:00:00.000Z',
			false,
			true,
		),
	);
	assert.deepEqual(toTimed?.exdates, ['2026-12-04T09:00:00.000Z']);
});

function shifted(rule: string, from: string, to: string, allDay = false) {
	return parseRecurrenceRule(withShiftedExclusions(rule, from, to, allDay))?.exdates;
}

test('monthly and yearly exceptions follow their occurrence when the start moves', () => {
	// Monthly 15th, 4th occurrence (April) cancelled; start moves one month later.
	assert.deepEqual(
		shifted(
			'FREQ=MONTHLY;EXDATE=2026-04-15T17:00:00.000Z',
			'2026-01-15T18:00:00.000Z',
			'2026-02-15T18:00:00.000Z',
		),
		['2026-05-15T17:00:00.000Z'],
	);
	// Month-end clamp: 31 Jan -> 30 Jan keeps the cancelled 28 Feb occurrence cancelled.
	assert.deepEqual(
		shifted(
			'FREQ=MONTHLY;EXDATE=2026-02-28T18:00:00.000Z',
			'2026-01-31T18:00:00.000Z',
			'2026-01-30T18:00:00.000Z',
		),
		['2026-02-28T18:00:00.000Z'],
	);
	// Yearly across a leap year.
	assert.deepEqual(
		shifted(
			'FREQ=YEARLY;EXDATE=2028-01-15T18:00:00.000Z',
			'2026-01-15T18:00:00.000Z',
			'2026-03-15T18:00:00.000Z',
		),
		['2028-03-15T18:00:00.000Z'],
	);
	// All-day monthly.
	assert.deepEqual(
		shifted(
			'FREQ=MONTHLY;EXDATE=2026-04-15T00:00:00.000Z',
			'2026-01-15T00:00:00.000Z',
			'2026-02-15T00:00:00.000Z',
			true,
		),
		['2026-05-15T00:00:00.000Z'],
	);
});
