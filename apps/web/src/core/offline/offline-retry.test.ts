import assert from 'node:assert/strict';
import test from 'node:test';
import { type OfflineAction, shouldRetryOfflineAction } from './offline-queue';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function action(attempts: number | undefined, lastAttemptAt?: string): OfflineAction {
	return {
		id: 'a',
		idempotencyKey: '55555555-5555-4555-8555-555555555555',
		type: 'announcement.create',
		shareCode: 'MTE8PZAT',
		memberId: 'm',
		createdAt: new Date(NOW - 1000).toISOString(),
		payload: {},
		...(attempts === undefined ? {} : { attempts }),
		...(lastAttemptAt ? { lastAttemptAt } : {}),
	} as OfflineAction;
}
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('an action that was never sent is retried right away', () => {
	assert.equal(shouldRetryOfflineAction(action(undefined), NOW), true);
	assert.equal(shouldRetryOfflineAction(action(3), NOW), true);
});

test('one counted attempt waits 30 seconds, two wait one minute', () => {
	assert.equal(shouldRetryOfflineAction(action(1, ago(29_999)), NOW), false);
	assert.equal(shouldRetryOfflineAction(action(1, ago(30 * SECOND)), NOW), true);
	assert.equal(shouldRetryOfflineAction(action(2, ago(59_999)), NOW), false);
	assert.equal(shouldRetryOfflineAction(action(2, ago(MINUTE)), NOW), true);
});

test('a failure that counted no attempt does not delay the next sync', () => {
	assert.equal(shouldRetryOfflineAction(action(0, ago(0)), NOW), true);
});

test('the delay stops growing at 15 minutes', () => {
	for (const attempts of [6, 12, 40]) {
		assert.equal(shouldRetryOfflineAction(action(attempts, ago(15 * MINUTE - 1)), NOW), false);
		assert.equal(shouldRetryOfflineAction(action(attempts, ago(15 * MINUTE)), NOW), true);
	}
});

test('an unreadable attempt time does not block the action', () => {
	assert.equal(shouldRetryOfflineAction(action(4, 'not a date'), NOW), true);
});

test('an attempt stamped in the future (clock corrected backwards) does not block for long', () => {
	// The stamp is a day ahead of the corrected clock: a delay of one step, not a day.
	const future = new Date(NOW + 24 * 60 * MINUTE).toISOString();
	assert.equal(shouldRetryOfflineAction(action(1, future), NOW + 30 * SECOND), true);
});
