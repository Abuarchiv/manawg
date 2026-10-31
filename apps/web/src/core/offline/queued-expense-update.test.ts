import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createQueuedExpenseUpdate,
	type OfflineAction,
	withQueuedExpenseUpdate,
} from './offline-queue';

const shareCode = 'MTE8PZAT';
const memberId = '33333333-3333-4333-8333-333333333333';
const otherMemberId = '44444444-4444-4444-8444-444444444444';
const expenseId = '11111111-1111-4111-8111-111111111111';
const serverVersion = '2026-10-01T10:00:00.000Z';

function update(overrides: {
	description: string;
	expectedUpdatedAt: string;
	now: number;
	memberId?: string;
	expenseId?: string;
}): OfflineAction {
	return createQueuedExpenseUpdate({
		shareCode,
		memberId,
		expenseId,
		amountCents: 1000,
		paidByMemberId: memberId,
		splits: [{ debtorMemberId: memberId, amountCents: 1000 }],
		imageUrl: null,
		...overrides,
	});
}

const first = update({ description: 'Einkauf A', expectedUpdatedAt: serverVersion, now: 1000 });
const second = update({
	description: 'Einkauf B',
	expectedUpdatedAt: '2026-10-31T12:00:00.000Z',
	now: 2000,
});

test('a second edit of the same expense replaces the queued update and keeps the server version', () => {
	const result = withQueuedExpenseUpdate([first], second);
	assert.equal(result.length, 1);
	assert.equal(result[0]?.payload.description, 'Einkauf B');
	assert.equal(result[0]?.payload.expectedUpdatedAt, serverVersion);
});

test('the replacement keeps its place in the queue', () => {
	const other = update({
		description: 'Anderes',
		expectedUpdatedAt: serverVersion,
		now: 500,
		expenseId: '22222222-2222-4222-8222-222222222222',
	});
	const result = withQueuedExpenseUpdate([first, other], second);
	assert.deepEqual(
		result.map((action) => action.payload.description),
		['Einkauf B', 'Anderes'],
	);
});

test('an update that was already sent or awaits review is not replaced', () => {
	for (const sent of [
		{ ...first, lastAttemptAt: '2026-10-31T12:00:00.000Z' },
		{ ...first, needsReview: 'server' as const },
	]) {
		const result = withQueuedExpenseUpdate([sent], second);
		assert.equal(result.length, 2);
		assert.equal(result[1], second);
	}
});

test('updates of another expense or by another member are appended', () => {
	const otherExpense = update({
		description: 'X',
		expectedUpdatedAt: serverVersion,
		now: 3000,
		expenseId: '22222222-2222-4222-8222-222222222222',
	});
	const otherMember = update({
		description: 'Y',
		expectedUpdatedAt: serverVersion,
		now: 3000,
		memberId: otherMemberId,
	});
	assert.equal(withQueuedExpenseUpdate([first], otherExpense).length, 2);
	assert.equal(withQueuedExpenseUpdate([first], otherMember).length, 2);
});

test('other action types are appended unchanged', () => {
	const create = { ...first, type: 'expense.create' as const };
	assert.equal(withQueuedExpenseUpdate([create], second).length, 2);
});

test('a date changed by the first edit stays queued when the second edit sends none', () => {
	const dated = { ...first, payload: { ...first.payload, occurredAt: '2026-10-05T10:00:00.000Z' } };
	const result = withQueuedExpenseUpdate([dated], second);
	assert.equal(result[0]?.payload.description, 'Einkauf B');
	assert.equal(result[0]?.payload.occurredAt, '2026-10-05T10:00:00.000Z');
});
