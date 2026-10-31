import assert from 'node:assert/strict';
import test from 'node:test';
import { expandRecurrence } from '../src/features/events/events.ts';
import { withShiftedExclusions } from '../src/features/events/recurrence-shift.ts';
import { withEventWindowCandidates } from '../src/features/events/server/event-reminder-window.ts';
import { eventCandidate, eventCandidatePages } from './support/event-candidates.ts';

const event = {
	id: 'precise-series',
	title: 'Meeting',
	description: null,
	startsAt: '2026-03-28T12:30:45.123Z',
	endsAt: null,
	allDay: false,
	location: null,
	recurrence: 'FREQ=DAILY;COUNT=3;EXDATE=2026-03-29T11:30:45.123Z',
};

test('timed recurrence preserves seconds and exceptions across daylight saving', () => {
	assert.deepEqual(
		expandRecurrence(event, '2026-03-28', '2026-03-31').map((item) => item.startsAt),
		['2026-03-28T12:30:45.123Z', '2026-03-30T11:30:45.123Z'],
	);
});

test('minute-rounded exceptions from existing series remain excluded', () => {
	assert.deepEqual(
		expandRecurrence(
			{ ...event, recurrence: 'FREQ=DAILY;COUNT=3;EXDATE=2026-03-29T11:30:00.000Z' },
			'2026-03-28',
			'2026-03-31',
		).map((item) => item.startsAt),
		['2026-03-28T12:30:45.123Z', '2026-03-30T11:30:45.123Z'],
	);
});

test('an existing exclusion in the repeated autumn hour remains excluded', () => {
	assert.deepEqual(
		expandRecurrence(
			{
				...event,
				startsAt: '2026-10-25T00:30:45.123Z',
				recurrence: 'FREQ=DAILY;COUNT=2;EXDATE=2026-10-25T01:30:00.000Z',
			},
			'2026-10-25',
			'2026-10-27',
		).map((item) => item.startsAt),
		['2026-10-26T01:30:45.123Z'],
	);
});

test('the first recurrence keeps the stored instant in the repeated autumn hour', () => {
	const startsAt = '2026-10-25T00:30:00.000Z';
	assert.deepEqual(
		expandRecurrence(
			{ ...event, startsAt, recurrence: 'FREQ=DAILY;COUNT=2' },
			'2026-10-25',
			'2026-10-27',
		).map((item) => item.startsAt),
		[startsAt, '2026-10-26T01:30:00.000Z'],
	);
});

test('moving a precise series keeps its removed occurrence removed', () => {
	const startsAt = '2026-03-29T11:30:12.345Z';
	const recurrence = withShiftedExclusions(event.recurrence, event.startsAt, startsAt, false);
	assert.deepEqual(
		expandRecurrence({ ...event, startsAt, recurrence }, '2026-03-29', '2026-04-01').map(
			(item) => item.startsAt,
		),
		[startsAt, '2026-03-31T11:30:12.345Z'],
	);
});

test('candidate pruning retains the final occurrence until its exact end', async () => {
	const from = new Date('2026-03-29T12:30:30.000Z');
	const row = eventCandidate('precise-last', event.startsAt, 'FREQ=DAILY;COUNT=2');
	assert.deepEqual(
		await withEventWindowCandidates(
			from,
			eventCandidatePages([row]),
			() => 'overflow',
			(rows) => rows.map((item) => item.id),
		),
		[row.id],
	);
});
