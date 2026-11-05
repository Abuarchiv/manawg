import assert from 'node:assert/strict';
import test from 'node:test';
import {
	backfillIdempotencyKey,
	editQueuedPayload,
	getRecurringAdvancePayload,
	isChoreAlreadyCompleted,
	isRecurringAlreadyAdvanced,
	isTerminalReplayStatus,
	mergeSyncOutcomes,
	needsReviewAfterRequest,
} from './offline-replay-rules';

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

test('removing a photo that never left the device or was refused keeps the action sendable', () => {
	const waiting = {
		...queuedExpense,
		payload: { description: 'Pizza', imageUrl: 'manawg-pending-image:abc' },
		attempts: 1,
		lastAttemptAt: '2026-10-01T10:05:00.000Z',
	};
	assert.equal(editQueuedPayload(waiting, { imageUrl: null }).needsReview, undefined);
	const refused = {
		...queuedExpense,
		attempts: 1,
		lastAttemptAt: '2026-10-01T10:05:00.000Z',
		needsReview: 'imageRemoved' as const,
	};
	assert.equal(editQueuedPayload(refused, { imageUrl: null }).needsReview, 'imageRemoved');
});

test('a queued action keeps its idempotency key, so a replay cannot book twice', () => {
	assert.equal(backfillIdempotencyKey(queuedExpense), queuedExpense);
	const { idempotencyKey: _, ...withoutKey } = queuedExpense;
	assert.match(backfillIdempotencyKey(withoutKey).idempotencyKey ?? '', /^[0-9a-f-]{36}$/);
});

test('a new idempotency key during a request counts as an edit', () => {
	const rekeyed = { ...queuedExpense, idempotencyKey: '66666666-6666-4666-8666-666666666666' };
	assert.equal(needsReviewAfterRequest(queuedExpense, queuedExpense), false);
	assert.equal(needsReviewAfterRequest(rekeyed, queuedExpense), true);
});

test('only a payload or key change during a request asks for review', () => {
	const retried = { ...queuedExpense, attempts: 2, lastAttemptAt: '2026-10-01T10:06:00.000Z' };
	const edited = { ...queuedExpense, payload: { ...queuedExpense.payload, description: 'Pasta' } };
	const reviewIds = new Set<string>();
	const outcome = { snapshot: queuedExpense, reviewOnEdit: true };
	assert.deepEqual(
		mergeSyncOutcomes([retried], new Map([[queuedExpense.id, outcome]]), reviewIds),
		[retried],
	);
	assert.equal(reviewIds.size, 0);
	mergeSyncOutcomes([edited], new Map([[queuedExpense.id, outcome]]), reviewIds);
	assert.deepEqual([...reviewIds], [queuedExpense.id]);
});

test('only a queued expense advances its fixed cost', () => {
	const payload = {
		recurringExpenseId: 'rec-1',
		expectedRecurringNextDueAt: '2026-11-01T00:00:00.000Z',
	};
	assert.deepEqual(getRecurringAdvancePayload({ ...queuedExpense, payload }), {
		id: 'rec-1',
		expectedNextDueAt: '2026-11-01T00:00:00.000Z',
	});
	assert.equal(
		getRecurringAdvancePayload({ ...queuedExpense, type: 'expense.update', payload }),
		null,
	);
});

test('"already done" answers count only as a conflict on the matching action', () => {
	const done = { status: 409, error: 'chore_already_completed' };
	const chore = { ...queuedExpense, type: 'chore.complete' as const };
	assert.equal(isChoreAlreadyCompleted(chore, done), true);
	assert.equal(isChoreAlreadyCompleted(queuedExpense, done), false);
	assert.equal(
		isRecurringAlreadyAdvanced({ status: 409, error: 'recurring_expense_already_advanced' }),
		true,
	);
	assert.equal(
		isRecurringAlreadyAdvanced({ status: 400, error: 'recurring_expense_already_advanced' }),
		false,
	);
});
