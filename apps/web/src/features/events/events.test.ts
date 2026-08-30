// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	type EventInput,
	expandRecurrence,
	formatEventTimeRange,
	formatRecurrenceRule,
	getMonthBounds,
	nextOccurrence,
	parseRecurrenceRule,
	validateEventForm,
} from './events';

// Mirrors the internal MAX_EXPAND_ITERATIONS bound in events.ts (not
// exported). Used to assert that regression fixtures are old enough that a
// naive one-period-per-iteration walk from startsAt could not have reached
// the query window within the budget.
const MAX_EXPAND_ITERATIONS_UNDER_TEST = 366;

const BASE_EVENT: EventInput = {
	id: 'evt-1',
	title: 'Standup',
	description: null,
	startsAt: '2026-06-01T08:00:00.000Z',
	endsAt: '2026-06-01T08:30:00.000Z',
	allDay: false,
	location: null,
	recurrence: null,
};

describe('parseRecurrenceRule', () => {
	it('returns null for empty or invalid input', () => {
		expect(parseRecurrenceRule(null)).toBeNull();
		expect(parseRecurrenceRule('')).toBeNull();
		expect(parseRecurrenceRule('not-a-rule')).toBeNull();
		expect(parseRecurrenceRule('FREQ=HOURLY')).toBeNull();
		expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')).toBeNull();
	});

	it('parses FREQ and defaults INTERVAL to 1', () => {
		const rule = parseRecurrenceRule('FREQ=WEEKLY');
		expect(rule).toEqual({ freq: 'WEEKLY', interval: 1 });
	});

	it('parses INTERVAL, BYDAY, COUNT and UNTIL', () => {
		const rule = parseRecurrenceRule(
			'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4;UNTIL=2026-12-31T00:00:00.000Z',
		);
		expect(rule).toEqual({
			freq: 'WEEKLY',
			interval: 2,
			byDay: ['MO', 'WE'],
			count: 4,
			until: '2026-12-31T00:00:00.000Z',
		});
	});

	it('rejects unknown BYDAY codes', () => {
		expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=XX')).toBeNull();
	});
});

describe('formatRecurrenceRule', () => {
	it('formats a daily rule with interval and count', () => {
		const formatted = formatRecurrenceRule({ freq: 'DAILY', interval: 3, count: 5 });
		expect(formatted).toBe('FREQ=DAILY;INTERVAL=3;COUNT=5');
	});

	it('omits INTERVAL when it is 1', () => {
		const formatted = formatRecurrenceRule({ freq: 'WEEKLY', interval: 1, byDay: ['MO'] });
		expect(formatted).toBe('FREQ=WEEKLY;BYDAY=MO');
	});

	it('roundtrips through parse', () => {
		const original = 'FREQ=MONTHLY;INTERVAL=2;COUNT=6';
		const parsed = parseRecurrenceRule(original);
		expect(parsed).not.toBeNull();
		if (parsed) expect(formatRecurrenceRule(parsed)).toBe(original);
	});
});

describe('expandRecurrence', () => {
	it('returns the single occurrence for a non-recurring event in window', () => {
		const occ = expandRecurrence(
			BASE_EVENT,
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-30T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(1);
		expect(occ[0]?.startsAt).toBe(BASE_EVENT.startsAt);
		expect(occ[0]?.recurring).toBe(false);
	});

	it('returns empty array when the single event is outside the window', () => {
		const occ = expandRecurrence(
			BASE_EVENT,
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-31T23:59:59.000Z'),
		);
		expect(occ).toEqual([]);
	});

	it('expands a daily rule with COUNT', () => {
		const occ = expandRecurrence(
			{ ...BASE_EVENT, recurrence: 'FREQ=DAILY;COUNT=3' },
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-30T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(3);
		expect(occ[0]?.startsAt).toBe('2026-06-01T08:00:00.000Z');
		expect(occ[1]?.startsAt).toBe('2026-06-02T08:00:00.000Z');
		expect(occ[2]?.startsAt).toBe('2026-06-03T08:00:00.000Z');
		expect(occ.every((o) => o.recurring)).toBe(true);
	});

	it('honors WEEKLY BYDAY restrictions', () => {
		const monday = '2026-06-01T08:00:00.000Z';
		const occ = expandRecurrence(
			{ ...BASE_EVENT, startsAt: monday, recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE' },
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-14T23:59:59.000Z'),
		);
		const days = occ.map((o) => new Date(o.startsAt).getUTCDay());
		expect(days.every((d) => d === 1 || d === 3)).toBe(true);
		expect(occ.length).toBeGreaterThanOrEqual(3);
	});

	it('expands WEEKLY BYDAY even when the anchor day differs from the requested weekday', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2026-06-03T08:00:00.000Z',
				endsAt: '2026-06-03T08:30:00.000Z',
				recurrence: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-30T23:59:59.000Z'),
		);
		expect(occ.map((o) => o.startsAt)).toEqual([
			'2026-06-08T08:00:00.000Z',
			'2026-06-15T08:00:00.000Z',
			'2026-06-22T08:00:00.000Z',
		]);
	});

	it('keeps WEEKLY BYDAY occurrences at the same Berlin wall time across the fall-back DST transition (2026-10-25)', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2026-06-01T18:00:00.000Z', // Monday 20:00 Berlin (CEST)
				endsAt: '2026-06-01T18:30:00.000Z',
				recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH',
			},
			new Date('2026-10-19T00:00:00.000Z'),
			new Date('2026-10-30T00:00:00.000Z'),
		);
		// Before the transition: 20:00 Berlin = 18:00Z (CEST, UTC+2).
		// After it: 20:00 Berlin = 19:00Z (CET, UTC+1) — same wall clock time,
		// different UTC instant. A bug here would leave every post-transition
		// occurrence an hour off (still 18:00Z) or double-shift it (20:00Z).
		expect(occ.map((o) => o.startsAt)).toEqual([
			'2026-10-19T18:00:00.000Z',
			'2026-10-22T18:00:00.000Z',
			'2026-10-26T19:00:00.000Z',
			'2026-10-29T19:00:00.000Z',
		]);
	});

	it('honors UNTIL bound', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				recurrence: 'FREQ=DAILY;UNTIL=2026-06-03T00:00:00.000Z',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-30T23:59:59.000Z'),
		);
		expect(occ.length).toBeLessThanOrEqual(3);
	});

	it('expands MONTHLY yearly birthdays correctly', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2026-03-15T00:00:00.000Z',
				endsAt: null,
				allDay: true,
				recurrence: 'FREQ=YEARLY',
			},
			new Date('2026-01-01T00:00:00.000Z'),
			new Date('2026-12-31T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(1);
		expect(occ[0]?.startsAt).toBe('2026-03-15T00:00:00.000Z');
	});

	it('regression: DAILY event >400 days old still produces occurrences near "now" (bug: budget exhausted walking from startsAt)', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2025-01-01T08:00:00.000Z',
				endsAt: '2025-01-01T08:30:00.000Z',
				recurrence: 'FREQ=DAILY',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-07T23:59:59.000Z'),
		);
		expect(occ.length).toBe(7);
		// Anchor 08:00Z in winter CET = 09:00 Berlin wall; June is CEST, so
		// the wall time now maps to 07:00Z (DST-stable local time).
		expect(occ[0]?.startsAt).toBe('2026-06-01T07:00:00.000Z');
		expect(occ[6]?.startsAt).toBe('2026-06-07T07:00:00.000Z');
		// occurrenceIndex must reflect the true count from the original startsAt,
		// not reset to 0 just because we fast-forwarded into the window.
		expect(occ[0]?.occurrenceIndex).toBeGreaterThan(400);
	});

	it('regression: WEEKLY event >400 days old still produces occurrences near "now"', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2025-01-01T08:00:00.000Z', // Wednesday
				endsAt: '2025-01-01T08:30:00.000Z',
				recurrence: 'FREQ=WEEKLY',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-30T23:59:59.000Z'),
		);
		expect(occ.length).toBeGreaterThan(0);
		for (const o of occ) {
			expect(new Date(o.startsAt).getUTCDay()).toBe(3); // still Wednesday
		}
	});

	it('regression: WEEKLY BYDAY event >400 days old still produces occurrences near "now"', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2025-01-01T08:00:00.000Z',
				endsAt: '2025-01-01T08:30:00.000Z',
				recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-14T23:59:59.000Z'),
		);
		expect(occ.length).toBeGreaterThan(0);
		const days = occ.map((o) => new Date(o.startsAt).getUTCDay());
		expect(days.every((d) => d === 1 || d === 3 || d === 5)).toBe(true);
	});

	it('regression: COUNT-limited DAILY event that already ended before the window returns empty, not a false positive', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2025-01-01T08:00:00.000Z',
				endsAt: '2025-01-01T08:30:00.000Z',
				recurrence: 'FREQ=DAILY;COUNT=5',
			},
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-07T23:59:59.000Z'),
		);
		expect(occ).toEqual([]);
	});

	it('MONTHLY anchors on original startsAt — Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2026-01-31T08:00:00.000Z',
				endsAt: null,
				allDay: false,
				recurrence: 'FREQ=MONTHLY',
			},
			new Date('2026-01-01T00:00:00.000Z'),
			new Date('2026-06-01T00:00:00.000Z'),
		);
		const dates = occ.map((o) => o.startsAt);
		// Day-of-month stays anchored; UTC instant shifts with DST because
		// the 09:00 Berlin wall time is preserved (CET=+1, CEST=+2).
		expect(dates).toEqual([
			'2026-01-31T08:00:00.000Z',
			'2026-02-28T08:00:00.000Z',
			'2026-03-31T07:00:00.000Z',
			'2026-04-30T07:00:00.000Z',
			'2026-05-31T07:00:00.000Z',
		]);
	});

	it('regression: DAILY event 3+ years old still produces the current week (silent-data-loss scenario)', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2022-01-01T08:00:00.000Z',
				endsAt: '2022-01-01T08:30:00.000Z',
				recurrence: 'FREQ=DAILY',
			},
			new Date('2026-08-03T00:00:00.000Z'),
			new Date('2026-08-09T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(7);
		expect(occ[0]?.startsAt).toBe('2026-08-03T07:00:00.000Z');
		expect(occ[6]?.startsAt).toBe('2026-08-09T07:00:00.000Z');
		// >366 days between startsAt and the window proves MAX_EXPAND_ITERATIONS
		// could not have been walked one day at a time to reach this window.
		expect(occ[0]?.occurrenceIndex).toBeGreaterThan(MAX_EXPAND_ITERATIONS_UNDER_TEST);
	});

	it('regression: MONTHLY event 30+ years old still produces occurrences near "now" (day-of-month within window)', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '1995-01-01T08:00:00.000Z',
				endsAt: '1995-01-01T08:30:00.000Z',
				recurrence: 'FREQ=MONTHLY',
			},
			new Date('2026-08-01T00:00:00.000Z'),
			new Date('2026-08-31T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(1);
		expect(occ[0]?.startsAt).toBe('2026-08-01T07:00:00.000Z');
		// 31+ years * 12 months > MAX_EXPAND_ITERATIONS=366: an unskipped,
		// startsAt-anchored walk would have exhausted its budget before ever
		// reaching this window and silently returned [].
		expect(occ[0]?.occurrenceIndex).toBeGreaterThan(MAX_EXPAND_ITERATIONS_UNDER_TEST);
	});

	it('regression: YEARLY event 400 years old still produces occurrences near "now"', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '1626-08-05T08:00:00.000Z',
				endsAt: '1626-08-05T08:30:00.000Z',
				allDay: true,
				recurrence: 'FREQ=YEARLY',
			},
			new Date('2026-08-01T00:00:00.000Z'),
			new Date('2026-08-31T23:59:59.000Z'),
		);
		expect(occ).toHaveLength(1);
		expect(occ[0]?.startsAt).toBe('2026-08-05T08:00:00.000Z');
		expect(occ[0]?.occurrenceIndex).toBeGreaterThan(MAX_EXPAND_ITERATIONS_UNDER_TEST);
	});

	it('regression: MONTHLY INTERVAL=3, 20+ years old, still produces the correct occurrence near "now"', () => {
		const occ = expandRecurrence(
			{
				...BASE_EVENT,
				startsAt: '2005-02-01T08:00:00.000Z',
				endsAt: '2005-02-01T08:30:00.000Z',
				recurrence: 'FREQ=MONTHLY;INTERVAL=3',
			},
			new Date('2026-08-01T00:00:00.000Z'),
			new Date('2026-08-31T23:59:59.000Z'),
		);
		// Anchor is Feb, interval 3 -> Feb/May/Aug/Nov. August 2026 is a hit.
		expect(occ).toHaveLength(1);
		expect(occ[0]?.startsAt).toBe('2026-08-01T07:00:00.000Z');
	});
});

describe('nextOccurrence', () => {
	it('returns the next future occurrence of a recurring event', () => {
		const event: EventInput = {
			...BASE_EVENT,
			recurrence: 'FREQ=WEEKLY',
		};
		const next = nextOccurrence(event, '2026-06-02T00:00:00.000Z');
		expect(next).not.toBeNull();
		expect(next?.startsAt).toBe('2026-06-08T08:00:00.000Z');
	});

	it('returns null when the non-recurring event already passed', () => {
		const next = nextOccurrence(BASE_EVENT, '2026-07-01T00:00:00.000Z');
		expect(next).toBeNull();
	});
});

describe('formatEventTimeRange', () => {
	it('marks all-day events as ganztägig', () => {
		const occ = expandRecurrence(
			{ ...BASE_EVENT, allDay: true, endsAt: null },
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-02T00:00:00.000Z'),
		)[0];
		if (!occ) throw new Error('expected occurrence');
		expect(formatEventTimeRange(occ)).toContain('ganztägig');
	});

	it('formats a same-day time range', () => {
		const occ = expandRecurrence(
			BASE_EVENT,
			new Date('2026-06-01T00:00:00.000Z'),
			new Date('2026-06-02T00:00:00.000Z'),
		)[0];
		if (!occ) throw new Error('expected occurrence');
		expect(formatEventTimeRange(occ)).toMatch(/01\.06\..*–/);
	});
});

describe('getMonthBounds', () => {
	it('returns first and last instant of the month', () => {
		const { start, end } = getMonthBounds(new Date('2026-06-15T12:00:00.000Z'));
		expect(start.getFullYear()).toBe(2026);
		expect(start.getMonth()).toBe(5);
		expect(start.getDate()).toBe(1);
		expect(start.getHours()).toBe(0);
		expect(start.getMinutes()).toBe(0);
		expect(start.getSeconds()).toBe(0);
		expect(start.getMilliseconds()).toBe(0);
		expect(end.getFullYear()).toBe(2026);
		expect(end.getMonth()).toBe(5);
		expect(end.getDate()).toBe(30);
		expect(end.getHours()).toBe(23);
		expect(end.getMinutes()).toBe(59);
		expect(end.getSeconds()).toBe(59);
		expect(end.getMilliseconds()).toBe(999);
	});

	/**
	 * The calendar page is a client component, so "the month" is the viewer's
	 * month: June begins at midnight where they are, not at midnight UTC. An
	 * event at 00:30 on 1 June local time belongs in June, and UTC bounds would
	 * file it under May.
	 *
	 * The offsets below are only meaningful because the suite pins TZ to
	 * Europe/Berlin (see vitest.config.ts). Under UTC the two readings coincide
	 * and this test could not distinguish them.
	 */
	it('anchors the month to local midnight rather than UTC midnight', () => {
		const { start, end } = getMonthBounds(new Date('2026-06-15T12:00:00+02:00'));

		// Midnight on 1 June in Berlin is 22:00 on 31 May UTC.
		expect(start.toISOString()).toBe('2026-05-31T22:00:00.000Z');
		expect(end.toISOString()).toBe('2026-06-30T21:59:59.999Z');
	});
});

describe('validateEventForm', () => {
	const valid = { title: 'Standup', startsAt: '2026-06-01T08:00', endsAt: '' };

	it('accepts a titled event with a start and no end', () => {
		const result = validateEventForm(valid);
		expect(result).toMatchObject({ ok: true, endsAt: null });
	});

	it('rejects a blank title before anything else', () => {
		expect(validateEventForm({ ...valid, title: '   ', startsAt: '' })).toEqual({
			ok: false,
			error: 'Titel fehlt.',
		});
	});

	it('rejects a missing start', () => {
		expect(validateEventForm({ ...valid, startsAt: '' })).toEqual({
			ok: false,
			error: 'Startzeitpunkt fehlt.',
		});
	});

	it('rejects an end before the start', () => {
		expect(validateEventForm({ ...valid, endsAt: '2026-06-01T07:00' })).toEqual({
			ok: false,
			error: 'Endzeit liegt vor Startzeit.',
		});
	});

	it('accepts an end equal to the start', () => {
		expect(validateEventForm({ ...valid, endsAt: valid.startsAt })).toMatchObject({ ok: true });
	});
});
