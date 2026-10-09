import assert from 'node:assert/strict';
import test from 'node:test';
import { expandRecurrence } from './events';
import {
	MAX_EXDATES,
	formatRecurrenceRule,
	parseRecurrenceRule,
	withExcludedOccurrence,
} from './recurrence-rule';

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
	assert.equal(withExcludedOccurrence(rule, '2027-01-01T00:00:00.000Z'), null);
	assert.equal(parseRecurrenceRule(`${rule},2027-01-01T00:00:00.000Z`), null);
});

test('malformed exception dates make the rule invalid', () => {
	assert.equal(parseRecurrenceRule('FREQ=WEEKLY;EXDATE=nonsense'), null);
});
