// Calendar all-day events across Berlin DST and extreme time zones, recurrence and query windows.
// Why: A calendar day must be identical for every device time zone.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
	type EventInput,
	eventOverlapsCalendarDay,
	expandAgendaRecurrence,
	expandRecurrence,
} from '../src/features/events/events.ts';
import {
	buildEventsWindowFilter,
	computeTomorrowUtcWindow,
} from '../src/features/events/server/event-reminder-window.ts';
import { withEnv } from './support/env.ts';

describe('calendar fixes', () => {
	const ALL_DAY_EVENT: EventInput = {
		id: 'all-day-pilot',
		title: 'Pilottag',
		description: null,
		startsAt: '2026-09-29T00:00:00.000Z',
		endsAt: null,
		allDay: true,
		location: null,
		recurrence: null,
	};

	function expandAgenda(event: EventInput, from: string | Date, to: string | Date) {
		return expandAgendaRecurrence(event, new Date(from), new Date(to));
	}

	test('keeps inclusive multi-day all-day overlap across the Berlin fall DST date', () => {
		const occurrences = expandAgenda(
			{
				...ALL_DAY_EVENT,
				id: 'multi-day-pilot',
				startsAt: '2026-10-24T00:00:00.000Z',
				endsAt: '2026-10-25T00:00:00.000Z',
				recurrence: null,
			},
			'2026-10-25T18:00:00.000Z',
			'2026-10-25T22:00:00.000Z',
		);

		assert.equal(occurrences.length, 1);
		assert.equal(occurrences[0]?.startsAt, '2026-10-24T00:00:00.000Z');
		assert.equal(occurrences[0]?.endsAt, '2026-10-25T00:00:00.000Z');
	});

	test('matches event display dates and query windows using inclusive overlap', () => {
		const event = {
			startsAt: '2026-09-22T00:00:00.000Z',
			endsAt: '2026-09-24T00:00:00.000Z',
			allDay: true,
		};
		assert.deepEqual(
			[22, 23, 24, 25].map((day) => eventOverlapsCalendarDay(event, new Date(2026, 8, day))),
			[true, true, true, false],
		);

		const from = new Date('2026-09-23T12:00:00.000Z');
		const to = new Date('2026-09-26T00:00:00.000Z');
		const filter = buildEventsWindowFilter(from, to);
		assert.ok(filter);
		const query = new PgDialect().sqlToQuery(filter);
		const startsAtUpperBound = query.sql.match(/starts_at"\s*<=\s*\$(\d+)/);
		assert.ok(startsAtUpperBound);
		assert.equal(query.params[Number(startsAtUpperBound[1]) - 1], to.toISOString());
		const allDayBoundary = query.sql.match(
			/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>=\s*\$(\d+)/,
		);
		assert.ok(allDayBoundary);
		assert.equal(query.params[Number(allDayBoundary[1]) - 1], true);
		assert.equal(query.params[Number(allDayBoundary[2]) - 1], from.toISOString());
		const timedBoundary = query.sql.match(
			/"wg_events"\."all_day"\s*=\s*\$(\d+)\s+and\s+"wg_events"\."ends_at"\s*>\s*\$(\d+)/,
		);
		assert.ok(timedBoundary);
		assert.equal(query.params[Number(timedBoundary[1]) - 1], false);
		assert.equal(query.params[Number(timedBoundary[2]) - 1], from.toISOString());
	});

	test('uses Berlin calendar boundaries for all-day overlap and recurrence search', () => {
		withEnv({ TZ: 'Europe/Berlin' }, () => {
			assert.equal(
				expandAgenda(ALL_DAY_EVENT, '2026-09-28T22:01:00.000Z', '2026-09-28T23:00:00.000Z').length,
				1,
			);
			assert.equal(
				expandAgenda(ALL_DAY_EVENT, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').length,
				0,
			);

			const fallDstEvent = { ...ALL_DAY_EVENT, startsAt: '2026-10-25T00:00:00.000Z' };
			assert.equal(
				expandAgenda(fallDstEvent, '2026-10-24T22:30:00.000Z', '2026-10-24T23:00:00.000Z').length,
				1,
			);
			assert.equal(
				expandAgenda(fallDstEvent, '2026-10-25T23:30:00.000Z', '2026-10-26T00:00:00.000Z').length,
				0,
			);

			const daily = { ...ALL_DAY_EVENT, recurrence: 'FREQ=DAILY;COUNT=2' };
			assert.deepEqual(
				expandAgenda(daily, '2026-09-29T22:30:00.000Z', '2026-09-29T23:00:00.000Z').map(
					(occurrence) => occurrence.startsAt,
				),
				['2026-09-30T00:00:00.000Z'],
			);
		});
	});

	test('uses the runtime local calendar date before a UTC+14 event marker', () => {
		withEnv({ TZ: 'Pacific/Kiritimati' }, () => {
			const event = { ...ALL_DAY_EVENT, startsAt: '2026-01-01T00:00:00.000Z' };
			assert.equal(
				expandAgenda(event, '2025-12-31T10:30:00.000Z', '2025-12-31T11:00:00.000Z').length,
				1,
			);
			assert.equal(
				expandAgenda(event, '2026-01-01T10:30:00.000Z', '2026-01-01T11:00:00.000Z').length,
				0,
			);
		});
	});

	test('cron Berlin window excludes a finished all-day event on a UTC host', () => {
		const window = computeTomorrowUtcWindow(new Date('2026-09-29T09:00:00.000Z'));
		assert.equal(window.start.toISOString(), '2026-09-29T22:00:00.000Z');
		assert.equal(expandRecurrence(ALL_DAY_EVENT, window.start, window.end).length, 0);
	});
});
