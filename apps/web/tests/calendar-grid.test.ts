import assert from 'node:assert/strict';
import test from 'node:test';

const { buildDays, dayKey, groupChoresByDay, pickInitialFocusIndex, sameDay } = await import(
	'../src/features/events/calendar-grid.ts'
);

test('the month grid starts on Monday and fills whole weeks', () => {
	// October 2026 starts on a Thursday and ends on a Saturday.
	const days = buildDays(new Date(2026, 9, 15), [], new Map());
	assert.equal(days.length % 7, 0);
	assert.equal(days[0]?.date.getDay(), 1);
	assert.ok(sameDay(days[0]?.date ?? new Date(0), new Date(2026, 8, 28)));
	assert.equal(days.filter((day) => day.inCurrentMonth).length, 31);
});

test('chore due dates land on their local day', () => {
	const chore = { choreId: 'c1', title: 'Bad', startsAt: new Date(2026, 9, 3, 9).toISOString() };
	const byDay = groupChoresByDay([chore]);
	assert.deepEqual(byDay.get(dayKey(new Date(2026, 9, 3))), [chore]);
	const days = buildDays(new Date(2026, 9, 1), [], byDay);
	const third = days.find((day) => sameDay(day.date, new Date(2026, 9, 3)));
	assert.deepEqual(third?.chores, [chore]);
});

test('keyboard focus starts on the selected day, then today, then the first of the month', () => {
	const month = new Date(2026, 9, 1);
	const days = buildDays(month, [], new Map());
	const indexOf = (date: Date) => days.findIndex((day) => sameDay(day.date, date));
	assert.equal(
		pickInitialFocusIndex(days, new Date(2026, 9, 20), new Date(2026, 9, 5), month),
		indexOf(new Date(2026, 9, 20)),
	);
	assert.equal(
		pickInitialFocusIndex(days, null, new Date(2026, 9, 5), month),
		indexOf(new Date(2026, 9, 5)),
	);
	assert.equal(
		pickInitialFocusIndex(days, null, new Date(2026, 11, 5), month),
		indexOf(new Date(2026, 9, 1)),
	);
});
