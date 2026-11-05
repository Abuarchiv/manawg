import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventOccurrence } from './events';

const { buildDays, groupChoresByDay, pickInitialFocusIndex, sameDay } = await import(
	'./calendar-grid'
);

const occurrence = (startsAt: string, endsAt: string | null = null): EventOccurrence => ({
	eventId: 'e1',
	title: 'Putzen',
	description: null,
	startsAt,
	endsAt,
	allDay: false,
	location: null,
	recurring: false,
	occurrenceIndex: 0,
});

test('the month grid starts on Monday and fills whole weeks only', () => {
	// February 2027 starts on a Monday and has 28 days: exactly four rows.
	const february = buildDays(new Date(2027, 1, 10), [], new Map());
	assert.equal(february.length, 28);
	assert.equal(february[0]?.date.getDate(), 1);
	assert.ok(february.every((day) => day.inCurrentMonth));

	// November 2026 starts on a Sunday: six days of October lead, December fills the last row.
	const november = buildDays(new Date(2026, 10, 15), [], new Map());
	assert.equal(november.length, 42);
	assert.equal(november[0]?.date.getDay(), 1);
	assert.deepEqual(
		[november[0]?.date.getMonth(), november[0]?.date.getDate(), november[0]?.inCurrentMonth],
		[9, 26, false],
	);
	assert.equal(november[6]?.date.getDate(), 1);
	assert.equal(november[6]?.inCurrentMonth, true);
	assert.equal(november[41]?.inCurrentMonth, false);
});

test('events and chores land on their own day cells', () => {
	const chores = groupChoresByDay([
		{ choreId: 'c1', title: 'Bad', startsAt: new Date(2026, 10, 3, 9).toISOString() },
		{ choreId: 'c2', title: 'Küche', startsAt: new Date(2026, 10, 3, 18).toISOString() },
		{ choreId: 'c3', title: 'Flur', startsAt: new Date(2026, 11, 3, 9).toISOString() },
	]);
	const event = occurrence(
		new Date(2026, 10, 4, 19).toISOString(),
		new Date(2026, 10, 4, 20).toISOString(),
	);
	const days = buildDays(new Date(2026, 10, 1), [event], chores);
	const cell = (date: number) => days.find((day) => sameDay(day.date, new Date(2026, 10, date)));
	assert.deepEqual(
		cell(3)?.chores.map((chore) => chore.choreId),
		['c1', 'c2'],
	);
	assert.deepEqual(cell(3)?.occurrences, []);
	assert.deepEqual(cell(4)?.occurrences, [event]);
	assert.deepEqual(cell(4)?.chores, []);
});

test('focus goes to the selected day, else today in this month, else the first of the month', () => {
	const month = new Date(2026, 10, 1);
	const days = buildDays(month, [], new Map());
	const index = (date: Date) => days.findIndex((day) => sameDay(day.date, date));
	const today = new Date(2026, 10, 20, 15);
	assert.equal(
		pickInitialFocusIndex(days, new Date(2026, 10, 9), today, month),
		index(new Date(2026, 10, 9)),
	);
	assert.equal(pickInitialFocusIndex(days, new Date(2026, 11, 9), today, month), index(today));
	assert.equal(pickInitialFocusIndex(days, null, today, month), index(today));
	// Today in another month, even if its cell is visible, does not take the focus.
	assert.equal(
		pickInitialFocusIndex(days, null, new Date(2026, 11, 2), month),
		index(new Date(2026, 10, 1)),
	);
	assert.equal(pickInitialFocusIndex(days, new Date(2026, 9, 26), today, month), 0);
	assert.equal(pickInitialFocusIndex([], null, today, month), 0);
});
