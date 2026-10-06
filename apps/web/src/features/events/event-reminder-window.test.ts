import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EVENT_REMINDER_BUDGET } from './event-reminder-dispatch';
import { buildEventsWindowFilter, withEventWindowCandidates } from './event-reminder-window';
import { EVENTS_LIST_LIMIT, parseRecurrenceRule } from './events';

type Candidate = {
	id: string;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	recurrence: string | null;
};

function eventCandidate(
	id: string,
	startsAt: string,
	recurrence: string | null,
	{ allDay = false, endsAt = null }: { allDay?: boolean; endsAt?: string | null } = {},
): Candidate {
	return {
		id,
		startsAt: new Date(startsAt),
		endsAt: endsAt ? new Date(endsAt) : null,
		allDay,
		recurrence,
	};
}

function eventCandidatePages<T extends Candidate>(rows: readonly T[], pageSizes: number[] = []) {
	const ordered = [...rows].sort(
		(a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
	);
	return async (cursor: { startsAt: Date; id: string } | null, limit: number) => {
		pageSizes.push(limit);
		const afterCursor = cursor
			? ordered.filter(
					(row) =>
						row.startsAt.getTime() > cursor.startsAt.getTime() ||
						(row.startsAt.getTime() === cursor.startsAt.getTime() && row.id > cursor.id),
				)
			: ordered;
		return afterCursor.slice(0, limit);
	};
}

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
	const filter = buildEventsWindowFilter(from, to);
	assert.ok(filter);
	const query = new PgDialect().sqlToQuery(filter);
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

test('prunes old finite COUNT and UNTIL roots but retains long BYDAY and unknown rules', async () => {
	const from = new Date('2026-03-29T12:00:00.000Z');
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
		eventCandidate('timed-end-at-from', '2026-03-28T23:00:00.000Z', 'FREQ=DAILY;COUNT=1', {
			endsAt: '2026-03-29T12:00:00.000Z',
		}),
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

test('calendar rejects 1001 candidates while cron accepts 1001 across WGs', async () => {
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
	const cron = await withEventWindowCandidates(
		from,
		eventCandidatePages(rows),
		() => overflow,
		(candidates) => candidates.length,
		EVENT_REMINDER_BUDGET,
	);
	assert.deepEqual(calendar, overflow);
	assert.equal(cron, 1001);
});

test('cron sentinel overflow rejects 10001 roots before any claim or send', async () => {
	const rows = Array.from({ length: EVENT_REMINDER_BUDGET + 1 }, (_, index) =>
		eventCandidate(
			`event-${String(index).padStart(5, '0')}`,
			'2020-01-01T12:00:00.000Z',
			'FREQ=DAILY',
		),
	);
	const pageSizes: number[] = [];
	const overflow = { status: 503 };
	let claims = 0;
	let sends = 0;
	const result = await withEventWindowCandidates(
		new Date('2026-09-22T00:00:00.000Z'),
		eventCandidatePages(rows, pageSizes),
		() => overflow,
		() => {
			claims += 1;
			sends += 1;
			return { status: 200 };
		},
		EVENT_REMINDER_BUDGET,
	);
	assert.deepEqual(result, overflow);
	assert.equal(claims, 0);
	assert.equal(sends, 0);
	assert.equal(pageSizes.length, 21);
	assert.equal(pageSizes[20], 1);
});
