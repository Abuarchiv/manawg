import assert from 'node:assert/strict';
import test from 'node:test';
import { choreDueAtSchema } from './chore-due-at-schema';

test('a due date outside the supported years is rejected before the recurrence math can throw', () => {
	assert.equal(choreDueAtSchema.safeParse('2026-10-11T08:00:00+02:00').success, true);
	assert.equal(choreDueAtSchema.safeParse('9999-12-31T23:00:00Z').success, false);
	assert.equal(choreDueAtSchema.safeParse('0026-01-01T00:00:00Z').success, false);
});
