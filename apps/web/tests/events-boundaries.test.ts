import assert from 'node:assert/strict';
import test from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
	collectReminderOccurrences,
	startsInReminderWindow,
} from '../src/features/events/event-reminder-dispatch.ts';
import { eventOverlapsCalendarDay, expandRecurrence } from '../src/features/events/events.ts';
import { buildEventsWindowFilter } from '../src/features/events/server/event-reminder-window.ts';

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

test('API window keeps all-day end boundary but excludes timed end at from', () => {
	const from = new Date('2026-09-23T00:00:00.000Z');
	const to = new Date('2026-09-26T00:00:00.000Z');
	const filter = buildEventsWindowFilter(from, to);
	assert.ok(filter);
	const query = new PgDialect().sqlToQuery(filter);

	const allDayBoundary = query.sql.match(
		/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>=\s*\$(\d+)/,
	);
	assert.ok(allDayBoundary, 'all-day end at from is inclusive');
	assert.equal(query.params[Number(allDayBoundary[1]) - 1], true);
	assert.equal(query.params[Number(allDayBoundary[2]) - 1], from.toISOString());

	const timedBoundary = query.sql.match(
		/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>\s*\$(\d+)/,
	);
	assert.ok(timedBoundary, 'timed end at from is exclusive');
	assert.equal(query.params[Number(timedBoundary[1]) - 1], false);
	assert.equal(query.params[Number(timedBoundary[2]) - 1], from.toISOString());
});

test('API window includes timed null-end rows only when their default hour overlaps', () => {
	const from = new Date('2026-09-30T22:00:00.000Z');
	const to = new Date('2026-10-01T23:59:59.999Z');
	const query = new PgDialect().sqlToQuery(buildEventsWindowFilter(from, to) as SQL);
	const defaultHourOverlap = query.sql.match(
		/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s+is\s+null\s+and\s+"wg_events"\."starts_at"\s*>\s*\$(\d+)/,
	);
	assert.ok(defaultHourOverlap, 'timed rows without an end get the default-hour overlap branch');
	assert.equal(query.params[Number(defaultHourOverlap[1]) - 1], false);
	assert.equal(
		query.params[Number(defaultHourOverlap[2]) - 1],
		new Date(from.getTime() - 60 * 60 * 1000).toISOString(),
	);
	assert.ok(Date.parse('2026-09-30T21:30:00.000Z') > from.getTime() - 60 * 60 * 1000);
	assert.equal(Date.parse('2026-09-30T21:00:00.000Z') > from.getTime() - 60 * 60 * 1000, false);
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

	const query = new PgDialect().sqlToQuery(buildEventsWindowFilter(from, to) as SQL);
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

test('reminders include only occurrences that start tomorrow', () => {
	const from = new Date('2026-09-22T22:00:00.000Z');
	const to = new Date('2026-09-23T21:59:59.999Z');
	const ongoing = {
		id: 'ongoing',
		title: 'Ongoing',
		description: null,
		startsAt: '2026-09-22T00:00:00.000Z',
		endsAt: '2026-09-24T00:00:00.000Z',
		allDay: true,
		location: null,
		recurrence: null,
	};
	const tomorrow = { ...ongoing, id: 'tomorrow', startsAt: '2026-09-23T00:00:00.000Z' };
	const due = collectReminderOccurrences([ongoing, tomorrow], (event) =>
		expandRecurrence(event, from, to).filter((occ) => startsInReminderWindow(occ, from, to)),
	);
	assert.deepEqual(
		due?.map(({ eventId }) => eventId),
		['tomorrow'],
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

test('a wide window can raise the expansion cap past one year of daily occurrences', () => {
	const event = {
		id: 'daily',
		title: 'Daily',
		description: null,
		startsAt: '2026-01-01T09:00:00.000Z',
		endsAt: null,
		allDay: false,
		location: null,
		recurrence: 'FREQ=DAILY',
	};
	const from = '2026-01-01T00:00:00.000Z';
	const to = '2027-04-01T00:00:00.000Z';
	assert.equal(expandRecurrence(event, from, to).length, 366);
	assert.ok(expandRecurrence(event, from, to, 500).length > 366);
});
