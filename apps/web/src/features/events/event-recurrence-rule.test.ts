import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_RECURRENCE_MAX } from '@/features/events/event-limits';
import { expandRecurrence } from './event-recurrence';
import {
	canonicalRecurrenceRule,
	formatRecurrenceRule,
	MAX_EXDATES,
	parseRecurrenceRule,
	withExcludedOccurrence,
} from './event-recurrence-rule';

const weekly = {
	id: 'e1',
	title: 'Plenum',
	description: null,
	startsAt: '2026-10-05T18:00:00.000Z',
	endsAt: '2026-10-05T19:00:00.000Z',
	allDay: false,
	location: null,
};
const starts = (recurrence: string) =>
	expandRecurrence(
		{ ...weekly, recurrence },
		'2026-10-01T00:00:00.000Z',
		'2026-10-31T00:00:00.000Z',
	).map((occurrence) => occurrence.startsAt);

test('a removed occurrence disappears from the series and the others stay', () => {
	const rule = withExcludedOccurrence('FREQ=WEEKLY', '2026-10-12T18:00:00.000Z');
	assert.ok(rule);
	assert.deepEqual(starts(rule), [
		'2026-10-05T18:00:00.000Z',
		'2026-10-19T18:00:00.000Z',
		// Berlin wall time stays 20:00 across the clock change on 25 October.
		'2026-10-26T19:00:00.000Z',
	]);
});

test('removed occurrences still count toward COUNT', () => {
	const rule = withExcludedOccurrence('FREQ=WEEKLY;COUNT=3', '2026-10-12T18:00:00.000Z');
	assert.ok(rule);
	assert.deepEqual(starts(rule), ['2026-10-05T18:00:00.000Z', '2026-10-19T18:00:00.000Z']);
});

test('the rule round-trips with its exceptions, sorted and without duplicates', () => {
	const parsed = parseRecurrenceRule(
		'FREQ=WEEKLY;EXDATE=2026-10-19T18:00:00.000Z,2026-10-12T18:00:00.000Z,2026-10-12T18:00:00.000Z',
	);
	assert.deepEqual(parsed?.exdates, ['2026-10-12T18:00:00.000Z', '2026-10-19T18:00:00.000Z']);
	assert.equal(
		formatRecurrenceRule(parsed ?? { freq: 'DAILY', interval: 1 }),
		'FREQ=WEEKLY;EXDATE=2026-10-12T18:00:00.000Z,2026-10-19T18:00:00.000Z',
	);
});

test('an occurrence is removed only once and only up to the limit', () => {
	const once = withExcludedOccurrence('FREQ=DAILY', '2026-10-12T18:00:00.000Z');
	assert.ok(once);
	assert.equal(withExcludedOccurrence(once, '2026-10-12T18:00:00.000Z'), null);
	let rule = 'FREQ=DAILY';
	for (let day = 0; day < MAX_EXDATES; day += 1) {
		const next = withExcludedOccurrence(rule, new Date(Date.UTC(2026, 9, 1 + day)).toISOString());
		assert.ok(next);
		rule = next;
	}
	assert.equal(withExcludedOccurrence(rule, '2031-01-01T00:00:00.000Z'), null);
	assert.equal(parseRecurrenceRule(`${rule},2031-01-01T00:00:00.000Z`), null);
});

test('malformed exception dates make the rule invalid', () => {
	assert.equal(parseRecurrenceRule('FREQ=WEEKLY;EXDATE=nonsense'), null);
});

test('unsupported or duplicate RRULE parts are rejected', () => {
	for (const rule of [
		'FREQ=MONTHLY;INTERVAL=1.5',
		'FREQ=DAILY;COUNT=2junk',
		'FREQ=DAILY;BYMONTHDAY=15;COUNT=2',
		'FREQ=DAILY;FREQ=WEEKLY;COUNT=2',
		'FREQ=WEEKLY;COUNT=2;COUNT=3',
	]) {
		assert.equal(parseRecurrenceRule(rule), null, rule);
	}
});

test('old DAILY series with BYDAY stay readable, new writes are rejected', () => {
	const rule = 'FREQ=DAILY;BYDAY=MO;COUNT=3';
	assert.deepEqual(parseRecurrenceRule(rule), {
		freq: 'DAILY',
		interval: 1,
		byDay: ['MO'],
		count: 3,
	});
	assert.equal(canonicalRecurrenceRule(rule).ok, false);
	assert.deepEqual(starts(rule), [
		'2026-10-05T18:00:00.000Z',
		'2026-10-06T18:00:00.000Z',
		'2026-10-07T18:00:00.000Z',
	]);
});

test('occurrence exclusions are kept in an old DAILY series with BYDAY', () => {
	const rule = withExcludedOccurrence('FREQ=DAILY;BYDAY=MO;COUNT=3', '2026-10-06T18:00:00.000Z');
	assert.ok(rule);
	assert.equal(rule, 'FREQ=DAILY;BYDAY=MO;COUNT=3;EXDATE=2026-10-06T18:00:00.000Z');
	assert.deepEqual(starts(rule), ['2026-10-05T18:00:00.000Z', '2026-10-07T18:00:00.000Z']);
});

test('a series with the most exceptions still fits the edit schema', () => {
	let rule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;INTERVAL=365;UNTIL=2200-12-31T23:59:59.000Z';
	for (let day = 0; day < MAX_EXDATES; day += 1) {
		const next = withExcludedOccurrence(rule, new Date(Date.UTC(2026, 9, 1 + day)).toISOString());
		assert.ok(next);
		rule = next;
	}
	assert.ok(rule.length <= EVENT_RECURRENCE_MAX, `${rule.length} characters`);
});

test('a weekly weekday series with a long interval still reaches a window just before its next block', () => {
	const occurrences = expandRecurrence(
		{ ...weekly, recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=100' },
		'2028-08-28T00:00:00.000Z',
		'2028-09-10T00:00:00.000Z',
	);
	assert.deepEqual(
		occurrences.map((occurrence) => occurrence.startsAt.slice(0, 10)),
		['2028-09-04', '2028-09-06'],
	);
});

test('a weekly series on Tuesday, Thursday, Friday and Saturday lands on those weekdays', () => {
	assert.deepEqual(starts('FREQ=WEEKLY;BYDAY=TU,TH,FR,SA').slice(0, 4), [
		'2026-10-06T18:00:00.000Z',
		'2026-10-08T18:00:00.000Z',
		'2026-10-09T18:00:00.000Z',
		'2026-10-10T18:00:00.000Z',
	]);
});
