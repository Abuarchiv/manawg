// Calendar windows: the display-day overlap and the shared calendar/reminder query filter use the
// same inclusive overlap, so an event shown on a day is also fetched for it.

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as drizzle from 'drizzle-orm';
import { type Predicate, predicateOperators, rowMatches } from './support/drizzle-predicates';

mock.module('drizzle-orm', { namedExports: { ...drizzle, ...predicateOperators } });

const { wgEvents } = await import('../src/core/db/schema');
const { eventOverlapsCalendarDay } = await import('../src/features/events/events');
const { buildEventsWindowFilter } = await import('../src/features/events/event-reminder-window');

interface EventRow {
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	recurrence: string | null;
}

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
	const filter = buildEventsWindowFilter(from, to) as Predicate | undefined;
	assert.notEqual(filter, undefined);
	const at = (base: Date, deltaMs: number) => new Date(base.getTime() + deltaMs);
	const fetched = (row: Partial<EventRow>) =>
		rowMatches(
			wgEvents,
			{ startsAt: from, endsAt: null, allDay: false, recurrence: null, ...row },
			filter,
		);
	const twoDaysBefore = at(from, -2 * 24 * 60 * 60 * 1000);

	// The window's upper bound is inclusive: an event starting exactly at `to` is fetched.
	assert.equal(fetched({ startsAt: to }), true);
	assert.equal(fetched({ startsAt: at(to, 1) }), false);
	// An all-day event that ends exactly at `from` still overlaps the window.
	assert.equal(fetched({ allDay: true, startsAt: twoDaysBefore, endsAt: from }), true);
	assert.equal(fetched({ allDay: true, startsAt: twoDaysBefore, endsAt: at(from, -1) }), false);
	// A timed event that ends exactly at `from` is over before the window starts.
	assert.equal(fetched({ allDay: false, startsAt: twoDaysBefore, endsAt: from }), false);
	assert.equal(fetched({ allDay: false, startsAt: twoDaysBefore, endsAt: at(from, 1) }), true);
});
