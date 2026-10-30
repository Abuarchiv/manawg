import assert from 'node:assert/strict';
import test from 'node:test';
import { startOfBerlinDay } from '../src/core/utils/berlin-day.ts';
import { MS_PER_HOUR } from '../src/core/utils/time.ts';
import {
	processReminderBatches,
	reminderCopyForOccurrence,
} from '../src/features/events/event-reminder-dispatch.ts';
import {
	EVENTS_LIST_LIMIT,
	expandRecurrence,
	parseRecurrenceRule,
} from '../src/features/events/events.ts';
import {
	computeTomorrowUtcWindow,
	forEachEventWindowPage,
	withEventWindowCandidates,
} from '../src/features/events/server/event-reminder-window.ts';

import { eventCandidate, eventCandidatePages } from './support/event-candidates.ts';

test('prunes old finite COUNT and UNTIL roots but retains long BYDAY and unknown rules', async () => {
	const from = new Date(2026, 2, 29, 12);
	const rows = [
		eventCandidate('expired-count', '2020-01-01T12:00:00.000Z', 'FREQ=DAILY;COUNT=5'),
		eventCandidate(
			'expired-until',
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY;UNTIL=2020-01-10T12:00:00.000Z',
		),
		eventCandidate(
			'long-weekly-count',
			'2020-01-01T12:00:00.000Z',
			'FREQ=WEEKLY;BYDAY=MO;COUNT=365',
		),
		eventCandidate(
			'sparse-weekly-count',
			'2020-01-01T12:00:00.000Z',
			'FREQ=WEEKLY;INTERVAL=365;BYDAY=MO;COUNT=2',
		),
		eventCandidate(
			'expired-count-before-until',
			'2026-03-20T12:00:00.000Z',
			'FREQ=DAILY;COUNT=2;UNTIL=2026-04-01T12:00:00.000Z',
		),
		eventCandidate(
			'expired-until-before-count',
			'2026-03-20T12:00:00.000Z',
			'FREQ=DAILY;COUNT=10;UNTIL=2026-03-22T12:00:00.000Z',
		),
		eventCandidate('unknown-rule', '2020-01-01T12:00:00.000Z', 'NOT-A-RRULE'),
		eventCandidate('year-135245', '2020-01-01T12:00:00.000Z', 'FREQ=YEARLY;INTERVAL=365;COUNT=366'),
		eventCandidate(
			'timed-end-at-from',
			new Date(from.getTime() - MS_PER_HOUR).toISOString(),
			'FREQ=DAILY;COUNT=1',
			{ endsAt: from.toISOString() },
		),
		eventCandidate('all-day-end-date-from', '2026-03-28T00:00:00.000Z', 'FREQ=DAILY;COUNT=1', {
			allDay: true,
			endsAt: '2026-03-29T00:00:00.000Z',
		}),
	];
	const pageSizes: number[] = [];
	const overflowResult = { status: 503, body: 'events_window_too_large' };
	const result = await withEventWindowCandidates(
		from,
		eventCandidatePages(rows, pageSizes),
		() => overflowResult,
		(candidates) => candidates.map(({ id }) => id),
	);

	assert.deepEqual(result, [
		'long-weekly-count',
		'sparse-weekly-count',
		'unknown-rule',
		'year-135245',
		'all-day-end-date-from',
	]);
	assert.ok(parseRecurrenceRule('FREQ=YEARLY;INTERVAL=365;COUNT=366'));
	assert.deepEqual(pageSizes, [500]);
});

test('prunes 1001 expired finite roots before applying the active candidate cap', async () => {
	const from = new Date('2026-09-22T00:00:00.000Z');
	const rows = [
		...Array.from({ length: 1001 }, (_, index) =>
			eventCandidate(
				`expired-${String(index).padStart(4, '0')}`,
				'2020-01-01T12:00:00.000Z',
				'FREQ=DAILY;COUNT=1',
			),
		),
		eventCandidate('active-infinite', '2020-01-01T12:00:00.000Z', 'FREQ=DAILY'),
	];
	const overflowResult = { status: 503, body: 'events_window_too_large' };
	const result = await withEventWindowCandidates(
		from,
		eventCandidatePages(rows),
		() => overflowResult,
		(candidates) => candidates.map(({ id }) => id),
	);
	assert.deepEqual(result, ['active-infinite']);
});

test('retains a yearly series whose Berlin wall date reaches year 10000', async () => {
	const rule = 'FREQ=YEARLY;INTERVAL=101;COUNT=80';
	assert.ok(parseRecurrenceRule(rule));
	const row = eventCandidate('year-10000-wall-date', '2020-12-31T23:30:00.000Z', rule);
	const result = await withEventWindowCandidates(
		new Date('2026-01-01T00:00:00.000Z'),
		eventCandidatePages([row]),
		() => ({ status: 503, body: 'events_window_too_large' }),
		(candidates) => candidates.map(({ id }) => id),
	);

	assert.deepEqual(result, ['year-10000-wall-date']);
});

test('weekly BYDAY UNTIL last start uses Berlin DST wall time and timed-end boundary', async () => {
	const series = eventCandidate(
		'dst-weekly-until',
		'2026-03-22T01:30:00.000Z',
		'FREQ=WEEKLY;BYDAY=SU;UNTIL=2026-03-29T01:30:00.000Z',
	);
	const overflowResult = { status: 503, body: 'events_window_too_large' };
	const active = await withEventWindowCandidates(
		new Date('2026-03-29T01:45:00.000Z'),
		eventCandidatePages([series]),
		() => overflowResult,
		(candidates) => candidates.map(({ id }) => id),
	);
	const expired = await withEventWindowCandidates(
		new Date('2026-03-29T02:30:00.000Z'),
		eventCandidatePages([series]),
		() => overflowResult,
		(candidates) => candidates.map(({ id }) => id),
	);
	assert.deepEqual(active, ['dst-weekly-until']);
	assert.deepEqual(expired, []);
});

test('UNTIL pruning places a summer-anchored 02:30 occurrence at 03:30 on the gap day', async () => {
	const series = eventCandidate(
		'dst-gap-until',
		'2025-06-01T00:30:00.000Z',
		'FREQ=DAILY;UNTIL=2026-03-29T01:00:00.000Z',
	);
	const overflowResult = { status: 503, body: 'events_window_too_large' };
	const run = (from: string) =>
		withEventWindowCandidates(
			new Date(from),
			eventCandidatePages([series]),
			() => overflowResult,
			(candidates) => candidates.map(({ id }) => id),
		);
	// The gap-day occurrence is 03:30 CEST (01:30Z), after UNTIL, so the series ends on 28.03.
	assert.deepEqual(await run('2026-03-28T05:00:00.000Z'), []);
	assert.deepEqual(await run('2026-03-28T01:45:00.000Z'), ['dst-gap-until']);
});

test('finite UNTIL pruning uses the last Berlin wall-time occurrence', async () => {
	const series = eventCandidate(
		'finite-weekly-until-after-dst',
		'2026-10-23T22:30:00.000Z',
		'FREQ=WEEKLY;UNTIL=2026-11-06T23:00:00.000Z',
	);
	const result = await withEventWindowCandidates(
		new Date('2026-11-06T00:15:00.000Z'),
		eventCandidatePages([series]),
		() => ({ status: 503, body: 'events_window_too_large' }),
		(candidates) => candidates.map(({ id }) => id),
	);

	assert.deepEqual(result, []);
});

test('finite COUNT pruning keeps the final Berlin wall-time occurrence through its end', async () => {
	const series = eventCandidate(
		'finite-weekly-count-after-dst',
		'2026-10-23T22:30:00.000Z',
		'FREQ=WEEKLY;COUNT=3',
	);
	const active = await withEventWindowCandidates(
		new Date('2026-11-06T23:45:00.000Z'),
		eventCandidatePages([series]),
		() => ({ status: 503, body: 'events_window_too_large' }),
		(candidates) => candidates.map(({ id }) => id),
	);
	const expired = await withEventWindowCandidates(
		new Date('2026-11-07T00:30:00.000Z'),
		eventCandidatePages([series]),
		() => ({ status: 503, body: 'events_window_too_large' }),
		(candidates) => candidates.map(({ id }) => id),
	);

	assert.deepEqual(active, ['finite-weekly-count-after-dst']);
	assert.deepEqual(expired, []);
});

test('paged 1001 active candidates overflow before cron claim or send callbacks', async () => {
	const from = new Date('2026-09-22T00:00:00.000Z');
	const rows = Array.from({ length: EVENTS_LIST_LIMIT + 1 }, (_, index) =>
		eventCandidate(
			`unbounded-${String(index).padStart(4, '0')}`,
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY',
		),
	);
	const pageSizes: number[] = [];
	let claims = 0;
	let sends = 0;
	const overflowResult = { status: 503, body: 'events_window_too_large' };
	const result = await withEventWindowCandidates(
		from,
		eventCandidatePages(rows, pageSizes),
		() => overflowResult,
		async (candidates) => {
			for (const _candidate of candidates) {
				claims += 1;
				sends += 1;
			}
			return { status: 200 };
		},
	);

	assert.deepEqual(result, overflowResult);
	assert.equal(claims, 0);
	assert.equal(sends, 0);
	assert.deepEqual(pageSizes, [500, 500, 500]);

	const expiredRows = Array.from({ length: 10000 }, (_, index) =>
		eventCandidate(
			`expired-${String(index).padStart(5, '0')}`,
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY;COUNT=1',
		),
	);
	const exactScanPageSizes: number[] = [];
	let processedAtScanLimit = false;
	const exactScanResult = await withEventWindowCandidates(
		from,
		eventCandidatePages(expiredRows, exactScanPageSizes),
		() => overflowResult,
		() => {
			processedAtScanLimit = true;
			return { status: 200 };
		},
	);
	assert.deepEqual(exactScanResult, { status: 200 });
	assert.equal(processedAtScanLimit, true);
	assert.equal(exactScanPageSizes.length, 21);
	assert.ok(exactScanPageSizes.slice(0, 20).every((size) => size === 500));
	assert.equal(exactScanPageSizes[20], 1);

	const overScanPageSizes: number[] = [];
	let processedOverScanLimit = false;
	const overScanResult = await withEventWindowCandidates(
		from,
		eventCandidatePages(
			[
				...expiredRows,
				eventCandidate('sentinel', '2020-01-01T12:00:00.000Z', 'FREQ=DAILY;COUNT=1'),
			],
			overScanPageSizes,
		),
		() => overflowResult,
		() => {
			processedOverScanLimit = true;
			return { status: 200 };
		},
	);
	assert.deepEqual(overScanResult, overflowResult);
	assert.equal(processedOverScanLimit, false);
	assert.equal(overScanPageSizes.length, 21);
	assert.ok(overScanPageSizes.slice(0, 20).every((size) => size === 500));
	assert.equal(overScanPageSizes[20], 1);
});

test('calendar rejects 1001 candidates', async () => {
	const from = new Date('2026-09-22T00:00:00.000Z');
	const rows = Array.from({ length: EVENTS_LIST_LIMIT + 1 }, (_, index) => ({
		...eventCandidate(
			`event-${String(index).padStart(4, '0')}`,
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY',
		),
		wgId: `wg-${index % 2}`,
	}));
	const overflow = { status: 503 };
	const calendar = await withEventWindowCandidates(
		from,
		eventCandidatePages(rows),
		() => overflow,
		(candidates) => candidates.length,
	);
	assert.deepEqual(calendar, overflow);
});

test('reminder paging walks past 10000 roots and stops when the page handler asks', async () => {
	const from = new Date('2026-09-22T00:00:00.000Z');
	const rows = Array.from({ length: 10_001 }, (_, index) =>
		eventCandidate(
			`event-${String(index).padStart(5, '0')}`,
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY',
		),
	);
	const pageSizes: number[] = [];
	let seen = 0;
	const complete = await forEachEventWindowPage(
		from,
		eventCandidatePages(rows, pageSizes),
		async (page) => {
			seen += page.length;
			return true;
		},
	);
	assert.equal(complete, true);
	assert.equal(seen, 10_001);
	assert.equal(pageSizes.length, 21);

	const stoppedSizes: number[] = [];
	let handled = 0;
	const stopped = await forEachEventWindowPage(
		from,
		eventCandidatePages(rows, stoppedSizes),
		async () => {
			handled += 1;
			return handled < 2;
		},
	);
	assert.equal(stopped, false);
	assert.equal(stoppedSizes.length, 2);
});

test('reminder batches stop before claiming once the budget is spent', async () => {
	let claims = 0;
	let dispatched = 0;
	const released: number[] = [];
	const result = await processReminderBatches(
		Array.from({ length: 23 }, (_, index) => index),
		async () => {
			claims += 1;
			return true;
		},
		async () => {
			dispatched += 1;
			return { sent: 1, failures: [] };
		},
		async (index) => {
			released.push(index);
		},
		() => dispatched >= 10,
	);
	assert.deepEqual(result, { sent: 10, failed: 0, stopped: true });
	assert.equal(claims, 10);
	assert.deepEqual(released, []);
});

test('reminder batches claim only the current batch, limit concurrency, and release failures', async () => {
	let active = 0;
	let peak = 0;
	let claims = 0;
	let firstBatchDone = 0;
	let claimedFutureEarly = false;
	const released: number[] = [];
	const result = await processReminderBatches(
		Array.from({ length: 23 }, (_, index) => index),
		async (index) => {
			claims += 1;
			if (index >= 10 && firstBatchDone < 10) claimedFutureEarly = true;
			return true;
		},
		async (index) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setImmediate(resolve));
			active -= 1;
			if (index < 10) firstBatchDone += 1;
			if (index === 11) throw new Error('mock failure');
			return { sent: index === 20 ? 0 : 1 };
		},
		async (index) => {
			released.push(index);
		},
	);
	assert.equal(peak, 10);
	assert.equal(active, 0);
	assert.equal(claims, 23);
	assert.equal(claimedFutureEarly, false);
	assert.deepEqual(result, { sent: 21, failed: 1 });
	assert.deepEqual(released, [11, 20]);
});

test('reminder batch releases earlier claims when a later claim fails', async () => {
	const released: number[] = [];
	let sends = 0;
	await assert.rejects(
		processReminderBatches(
			[0, 1, 2],
			async (index) => {
				if (index === 1) throw new Error('claim failed');
				return true;
			},
			async () => {
				sends += 1;
				return { sent: 1 };
			},
			async (index) => {
				released.push(index);
			},
		),
		/claim failed/,
	);
	assert.equal(sends, 0);
	assert.deepEqual(released, [0]);
});

test('member occurrence partial failure retries only the failed member', async () => {
	const items = [
		{ eventId: 'event-1', occurrenceStartsAt: '2026-10-26T18:00:00.000Z', memberId: 'A' },
		{ eventId: 'event-1', occurrenceStartsAt: '2026-10-26T18:00:00.000Z', memberId: 'B' },
	];
	const claims = new Set();
	const attempts = new Map();
	const dispatches: string[] = [];
	const run = () =>
		processReminderBatches(
			items,
			async ({ memberId }) => {
				if (claims.has(memberId)) return false;
				claims.add(memberId);
				return true;
			},
			async ({ memberId }) => {
				dispatches.push(memberId);
				const attempt = attempts.get(memberId) ?? 0;
				attempts.set(memberId, attempt + 1);
				return memberId === 'B' && attempt === 0
					? { sent: 1, failures: ['one B device failed'] }
					: { sent: 1, failures: [] };
			},
			async ({ memberId }) => {
				claims.delete(memberId);
			},
		);

	assert.deepEqual(await run(), { sent: 1, failed: 1 });
	assert.deepEqual([...claims], ['A']);
	assert.deepEqual(await run(), { sent: 1, failed: 0 });
	assert.deepEqual(dispatches, ['A', 'B', 'B']);
	assert.deepEqual([...claims], ['A', 'B']);
});

test('today reminder selection keeps current all-day spans and excludes stale events', () => {
	const now = new Date('2026-03-29T10:00:00.000Z');
	const todayStart = startOfBerlinDay(now);
	const { start: tomorrowStart, end: tomorrowEnd } = computeTomorrowUtcWindow(now);
	const occurrence = (startsAt: string, endsAt: string | null, allDay = false) => ({
		startsAt,
		endsAt,
		allDay,
	});
	const classify = (value: ReturnType<typeof occurrence>) =>
		reminderCopyForOccurrence(value, now, todayStart, tomorrowStart, tomorrowEnd);

	assert.equal(
		classify(occurrence('2026-03-29T11:00:00.000Z', '2026-03-29T12:00:00.000Z')),
		'today',
	);
	assert.equal(classify(occurrence('2026-03-29T08:00:00.000Z', '2026-03-29T09:00:00.000Z')), null);
	assert.equal(
		classify(occurrence('2026-03-28T22:00:00.000Z', '2026-03-29T11:00:00.000Z')),
		'today',
	);
	assert.equal(
		classify(occurrence('2026-03-27T23:00:00.000Z', '2026-03-28T23:00:00.000Z', true)),
		'today',
	);
	assert.equal(
		classify(occurrence('2026-03-26T23:00:00.000Z', '2026-03-27T23:00:00.000Z', true)),
		null,
	);
	assert.equal(
		classify(occurrence('2026-03-29T22:30:00.000Z', '2026-03-29T23:30:00.000Z')),
		'tomorrow',
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
