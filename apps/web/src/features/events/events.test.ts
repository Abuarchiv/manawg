import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eventOverlapsCalendarDay, expandRecurrence, validateEventForm } from './events';
import { buildEventsWindowFilter } from './server/event-reminder-window';

// Regression: EventFormFields wires aria-invalid/aria-describedby to the field
// named here. Without `field` on the failure branch, every validation error
// pointed at no input at all (a WCAG 3.3.1 violation).
test('tags a missing title as the title field', () => {
	const result = validateEventForm({ title: '', startsAt: '2026-01-01T10:00', endsAt: '' });
	assert.equal(result.ok, false);
	assert.equal(result.field, 'title');
});

test('tags a missing start as the startsAt field', () => {
	const result = validateEventForm({ title: 'Meeting', startsAt: '', endsAt: '' });
	assert.equal(result.ok, false);
	assert.equal(result.field, 'startsAt');
});

test('tags an end before start as the endsAt field', () => {
	const result = validateEventForm({
		title: 'Meeting',
		startsAt: '2026-01-02T10:00',
		endsAt: '2026-01-01T10:00',
	});
	assert.equal(result.ok, false);
	assert.equal(result.field, 'endsAt');
});

test('valid input reports no field error', () => {
	const result = validateEventForm({
		title: 'Meeting',
		startsAt: '2026-01-01T10:00',
		endsAt: '2026-01-01T11:00',
	});
	assert.equal(result.ok, true);
});

test('a mistyped year is reported on its field instead of being saved', () => {
	const typoStart = validateEventForm({
		title: 'Meeting',
		startsAt: '0026-01-01T10:00',
		endsAt: '',
	});
	assert.equal(typoStart.ok, false);
	assert.equal(typoStart.field, 'startsAt');

	const typoEnd = validateEventForm({
		title: 'Meeting',
		startsAt: '2026-01-01T10:00',
		endsAt: '20266-01-01T11:00',
	});
	assert.equal(typoEnd.ok, false);
	assert.equal(typoEnd.field, 'endsAt');
});

test('timed event end is exclusive at midnight; all-day end date stays inclusive', () => {
	const previousTimezone = process.env.TZ;
	process.env.TZ = 'Europe/Berlin';
	try {
		const nextDay = new Date(2026, 8, 23);
		const allDay = {
			startsAt: '2026-09-22T00:00:00.000Z',
			endsAt: '2026-09-23T00:00:00.000Z',
			allDay: true,
		};
		const timedAtMidnight = {
			startsAt: '2026-09-22T10:00:00.000Z',
			endsAt: '2026-09-22T22:00:00.000Z',
			allDay: false,
		};
		const timedPastMidnight = { ...timedAtMidnight, endsAt: '2026-09-22T22:01:00.000Z' };

		assert.equal(eventOverlapsCalendarDay(allDay, nextDay), true, 'all-day end date is inclusive');
		assert.equal(eventOverlapsCalendarDay(timedPastMidnight, nextDay), true);
		assert.equal(
			eventOverlapsCalendarDay(timedAtMidnight, nextDay),
			false,
			'timed event ending at local midnight does not occupy the following day',
		);
	} finally {
		if (previousTimezone === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previousTimezone;
	}
});

test('an unbounded 2020 daily series contributes to a 2026 query window', () => {
	const event = {
		id: 'old-daily-series',
		title: 'Daily series',
		description: null,
		startsAt: '2020-01-01T12:00:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=DAILY',
	};
	const from = new Date('2026-09-22T00:00:00.000Z');
	const to = new Date('2026-09-22T23:59:59.999Z');
	const occurrences = expandRecurrence(event, from, to);

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-09-22T11:00:00.000Z'],
	);
	assert.ok(new Date(event.startsAt) < from);

	const filter = buildEventsWindowFilter(from, to);
	assert.ok(filter);
	const query = new PgDialect().sqlToQuery(filter);
	assert.equal(query.sql.includes('"wg_events"."recurrence" is not null'), true);
	assert.equal(query.params.includes('2024-09-22T00:00:00.000Z'), false);
});

test('daily timed recurrence advances Berlin dates across the autumn DST change', () => {
	const event = {
		id: 'daily-autumn-dst',
		title: 'Daily series',
		description: null,
		startsAt: '2026-10-23T22:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=DAILY',
	};
	const occurrences = expandRecurrence(event, '2026-10-23', '2026-10-28');

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		[
			'2026-10-23T22:30:00.000Z',
			'2026-10-24T22:30:00.000Z',
			'2026-10-25T23:30:00.000Z',
			'2026-10-26T23:30:00.000Z',
			'2026-10-27T23:30:00.000Z',
		],
	);
});

test('weekly timed recurrence keeps its Berlin weekday across the autumn DST change', () => {
	const event = {
		id: 'weekly-autumn-dst',
		title: 'Weekly series',
		description: null,
		startsAt: '2026-10-23T22:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY',
	};
	const occurrences = expandRecurrence(event, '2026-10-23', '2026-11-10');

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-10-23T22:30:00.000Z', '2026-10-30T23:30:00.000Z', '2026-11-06T23:30:00.000Z'],
	);
});

test('weekly timed recurrence applies UNTIL to the Berlin wall-time instant', () => {
	const event = {
		id: 'weekly-autumn-until',
		title: 'Weekly series',
		description: null,
		startsAt: '2026-10-23T22:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY;UNTIL=2026-11-06T23:00:00.000Z',
	};
	const occurrences = expandRecurrence(event, '2026-10-23', '2026-11-10');

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-10-23T22:30:00.000Z', '2026-10-30T23:30:00.000Z'],
	);
});

test('monthly timed recurrence clamps the Berlin day of month at 00:30 and 20:00', () => {
	const event = {
		id: 'monthly-clamp-at-midnight',
		title: 'Monthly series',
		description: null,
		startsAt: '2026-01-30T23:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=MONTHLY;COUNT=3',
	};
	const occurrences = expandRecurrence(event, '2026-01-30', '2026-04-01');

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-01-30T23:30:00.000Z', '2026-02-27T23:30:00.000Z', '2026-03-30T22:30:00.000Z'],
	);
	const eveningOccurrences = expandRecurrence(
		{ ...event, startsAt: '2026-01-31T19:00:00.000Z' },
		'2026-01-31',
		'2026-03-01',
	);
	assert.deepEqual(
		eveningOccurrences.map(({ startsAt }) => startsAt),
		['2026-01-31T19:00:00.000Z', '2026-02-28T19:00:00.000Z'],
	);
});

test('all-day recurrence keeps advancing by UTC calendar dates across DST', () => {
	const event = {
		id: 'all-day-autumn-dst',
		title: 'All-day series',
		description: null,
		startsAt: '2026-10-23T00:00:00.000Z',
		endsAt: null,
		allDay: true,
		location: null,
		recurrence: 'FREQ=WEEKLY;COUNT=3',
	};
	const occurrences = expandRecurrence(event, '2026-10-23', '2026-11-10');

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-10-23T00:00:00.000Z', '2026-10-30T00:00:00.000Z', '2026-11-06T00:00:00.000Z'],
	);
});

test('finite multi-day recurrence keeps an older occurrence overlapping the query', () => {
	const event = {
		id: 'multi-day-series',
		title: 'Multi-day series',
		description: null,
		startsAt: '2026-09-20T00:00:00.000Z',
		endsAt: '2026-09-22T00:00:00.000Z',
		allDay: true,
		location: null,
		recurrence: 'FREQ=DAILY;COUNT=3',
	};
	const occurrences = expandRecurrence(
		event,
		new Date('2026-09-23T12:00:00.000Z'),
		new Date('2026-09-23T23:59:59.999Z'),
	);
	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-09-22T00:00:00.000Z'],
	);
});

test('timed recurrence ending exactly at window start is not due again', () => {
	const event = {
		id: 'midnight-series',
		title: 'Evening event',
		description: null,
		startsAt: '2026-09-22T20:00:00.000Z',
		endsAt: '2026-09-22T22:00:00.000Z',
		allDay: false,
		location: null,
		recurrence: 'FREQ=DAILY;COUNT=2',
	};
	const occurrences = expandRecurrence(
		event,
		new Date('2026-09-22T22:00:00.000Z'),
		new Date('2026-09-23T21:59:59.999Z'),
	);
	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-09-23T20:00:00.000Z'],
	);
});

test('spring DST wall time is included when its raw UTC recurrence is beyond window end', () => {
	const event = {
		id: 'spring-dst-series',
		title: 'Spring DST series',
		description: null,
		startsAt: '2026-03-22T02:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY;COUNT=2',
	};
	const occurrences = expandRecurrence(
		event,
		new Date('2026-03-29T01:00:00.000Z'),
		new Date('2026-03-29T02:00:00.000Z'),
	);
	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-03-29T01:30:00.000Z'],
	);
});

test('spring-gap recurrence keeps the existing raw-instant fallback', () => {
	const event = {
		id: 'spring-gap-series',
		title: 'Spring-gap series',
		description: null,
		startsAt: '2026-03-22T01:30:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=WEEKLY;COUNT=2',
	};
	const occurrences = expandRecurrence(
		event,
		new Date('2026-03-29T00:00:00.000Z'),
		new Date('2026-03-29T02:00:00.000Z'),
	);

	assert.deepEqual(
		occurrences.map(({ startsAt }) => startsAt),
		['2026-03-29T01:30:00.000Z'],
	);
});

test('a yearly 29 February event falls on 28 February in common years', () => {
	const event = {
		id: 'birthday',
		title: 'Geburtstag',
		description: null,
		startsAt: '2028-02-29T00:00:00.000Z',
		endsAt: '2028-02-29T00:00:00.000Z',
		allDay: true,
		location: null,
		recurrence: 'FREQ=YEARLY',
	};
	const starts = expandRecurrence(event, '2028-01-01', '2033-01-01').map((occurrence) =>
		occurrence.startsAt.slice(0, 10),
	);
	assert.deepEqual(starts, ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
});
