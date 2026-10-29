// Agenda order follows the day a viewer sees, not the raw stored instant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByDisplayDate } from '../src/features/events/event-display.ts';
import { withEnv } from './support/env.ts';

test('an all-day event stored at UTC midnight sorts by its local calendar day west of UTC', () => {
	withEnv({ TZ: 'America/Los_Angeles' }, () => {
		const allDay = { id: 'a', startsAt: '2026-10-31T00:00:00.000Z', allDay: true };
		const timed = { id: 'b', startsAt: '2026-10-31T04:00:00.000Z', allDay: false };
		// The timed event is Oct 30 21:00 local, the all-day event is Oct 31.
		assert.deepEqual(
			sortByDisplayDate([allDay, timed]).map((item) => item.id),
			['b', 'a'],
		);
	});
});

test('an all-day event comes before timed events of its own day', () => {
	withEnv({ TZ: 'Europe/Berlin' }, () => {
		const allDay = { id: 'a', startsAt: '2026-10-31T00:00:00.000Z', allDay: true };
		const timed = { id: 'b', startsAt: '2026-10-31T08:00:00.000Z', allDay: false };
		assert.deepEqual(
			sortByDisplayDate([timed, allDay]).map((item) => item.id),
			['a', 'b'],
		);
	});
});
