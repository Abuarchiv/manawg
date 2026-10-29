import assert from 'node:assert/strict';
import test from 'node:test';
import { editQueuedPayload, isTerminalReplayStatus } from './offline-replay-rules';

test('a rejected request is terminal, replaying it cannot change the answer', () => {
	for (const status of [400, 401, 403, 404, 409, 410, 422]) {
		assert.equal(isTerminalReplayStatus(status), true, `status ${status}`);
	}
});

test('timeouts, Too Early and the rate limit are worth another attempt', () => {
	for (const status of [0, 408, 425, 429]) {
		assert.equal(isTerminalReplayStatus(status), false, `status ${status}`);
	}
});

test('server errors are retried, so they are not terminal', () => {
	for (const status of [200, 500, 502, 503]) {
		assert.equal(isTerminalReplayStatus(status), false, `status ${status}`);
	}
});

const queuedExpense = {
	id: 'expense:1',
	type: 'expense.create' as const,
	shareCode: 'CODE',
	memberId: 'member-a',
	createdAt: '2026-10-01T10:00:00.000Z',
	idempotencyKey: '55555555-5555-4555-8555-555555555555',
	payload: { description: 'Pizza', imageUrl: 'private/pizza.jpg' },
};

test('an edit to an action that never went out folds into its payload', () => {
	assert.deepEqual(editQueuedPayload(queuedExpense, { imageUrl: null }), {
		...queuedExpense,
		payload: { description: 'Pizza', imageUrl: null },
	});
});

test('an edit to an action that went out once is held for review', () => {
	const sent = { ...queuedExpense, attempts: 1, lastAttemptAt: '2026-10-01T10:05:00.000Z' };
	const edited = editQueuedPayload(sent, { imageUrl: null });
	assert.equal(edited.needsReview, 'server');
	assert.equal(edited.payload.imageUrl, null);
	assert.equal(edited.idempotencyKey, sent.idempotencyKey);
});
