import assert from 'node:assert/strict';
import test from 'node:test';
import { CHORE_INTERVAL_MAX_DAYS, CHORE_INTERVAL_MAX_MONTHS } from './chore-limits';

const { buildChorePatchUpdate } = await import('./chore-patch');

const dueAt = new Date('2026-11-30T12:00:00.000Z');
const daily = { intervalDays: 7, recurrenceType: 'days' as const, nextDueAt: dueAt };
const monthly = { intervalDays: 1, recurrenceType: 'months' as const, nextDueAt: dueAt };

test('a patch only carries the fields it changes', () => {
	assert.deepEqual(buildChorePatchUpdate(daily, { intervalDays: 14 }), {
		update: { intervalDays: 14 },
		validCadence: true,
	});
	assert.deepEqual(buildChorePatchUpdate(monthly, { intervalDays: 2 }).update, { intervalDays: 2 });
});

test('a new due date re-anchors only a monthly chore', () => {
	const next = '2026-12-31T12:00:00.000Z';
	assert.deepEqual(buildChorePatchUpdate(daily, { nextDueAt: next }).update, {
		nextDueAt: new Date(next),
	});
	assert.deepEqual(buildChorePatchUpdate(monthly, { nextDueAt: next }).update, {
		nextDueAt: new Date(next),
		anchorAt: new Date(next),
	});
	// Staying monthly without a new date keeps the existing anchor.
	assert.deepEqual(buildChorePatchUpdate(monthly, { recurrenceType: 'months' }).update, {
		recurrenceType: 'months',
	});
});

test('the interval must lie between 1 and the maximum of its unit', () => {
	const valid = (current: typeof daily | typeof monthly, intervalDays: number) =>
		buildChorePatchUpdate(current, { intervalDays }).validCadence;
	assert.equal(valid(daily, 0), false);
	assert.equal(valid(daily, 1), true);
	assert.equal(valid(daily, CHORE_INTERVAL_MAX_DAYS), true);
	assert.equal(valid(daily, CHORE_INTERVAL_MAX_DAYS + 1), false);
	assert.equal(valid(monthly, CHORE_INTERVAL_MAX_MONTHS), true);
	assert.equal(valid(monthly, CHORE_INTERVAL_MAX_MONTHS + 1), false);
});
