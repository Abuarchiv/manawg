import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { offlineActionHandlers } from './offline-action-handlers';
import type { OfflineAction, OfflineActionType } from './offline-queue';
import {
	createQueuedAbsence,
	createQueuedAnnouncement,
	createQueuedChore,
	createQueuedChoreCompletion,
	createQueuedExpense,
	createQueuedExpenseUpdate,
	createQueuedRecurring,
	createQueuedShoppingItem,
	createQueuedShoppingUpdate,
	getOfflineActionRequest,
} from './offline-queue';

// Characters that must be percent-encoded in a path segment.
const shareCode = 'A/B C?';
const memberId = '33333333-3333-4333-8333-333333333333';
const id = 'x/y z';
const encodedCode = 'A%2FB%20C%3F';
const encodedId = 'x%2Fy%20z';
const now = Date.parse('2026-10-01T10:00:00.000Z');
const splits = [{ debtorMemberId: memberId, amountCents: 100 }];
const identity = { shareCode, memberId, now };

const expenseInput = {
	...identity,
	description: 'Pizza',
	amountCents: 100,
	paidByMemberId: memberId,
	splits,
};

const advance = (payload: Record<string, unknown>): OfflineAction => ({
	id: 'recurring-advance:1',
	type: 'recurring.advance',
	shareCode,
	memberId,
	createdAt: new Date(now).toISOString(),
	payload,
});

const base = `/api/wg/${encodedCode}`;

const cases: Array<{
	type: OfflineActionType;
	action: OfflineAction;
	method: 'POST' | 'PATCH';
	path: string;
	/** Route file below src/app/api/wg/[code]/ that must export the replay method. */
	route: string;
}> = [
	{
		type: 'shopping.create',
		action: createQueuedShoppingItem({ ...identity, name: 'Milk', quantity: null }),
		method: 'POST',
		path: `${base}/shopping`,
		route: 'shopping/route.ts',
	},
	{
		type: 'shopping.update',
		action: createQueuedShoppingUpdate({
			...identity,
			itemId: id,
			name: 'Milk',
			bought: true,
			expectedUpdatedAt: '2026-10-01T09:00:00.000Z',
			expectedBoughtAt: null,
		}),
		method: 'PATCH',
		path: `${base}/shopping/${encodedId}`,
		route: 'shopping/[id]/route.ts',
	},
	{
		type: 'announcement.create',
		action: createQueuedAnnouncement({ ...identity, content: 'Hi', kind: 'note' }),
		method: 'POST',
		path: `${base}/announcements`,
		route: 'announcements/route.ts',
	},
	{
		type: 'absence.create',
		action: createQueuedAbsence({
			...identity,
			absenceMemberId: memberId,
			startDate: '2026-10-02',
			endDate: '2026-10-03',
			reason: null,
		}),
		method: 'POST',
		path: `${base}/absences`,
		route: 'absences/route.ts',
	},
	{
		type: 'chore.create',
		action: createQueuedChore({
			...identity,
			title: 'Trash',
			intervalDays: 7,
			assignedMemberId: null,
		}),
		method: 'POST',
		path: `${base}/chores`,
		route: 'chores/route.ts',
	},
	{
		type: 'chore.complete',
		action: createQueuedChoreCompletion({
			...identity,
			choreId: id,
			expectedNextDueAt: '2026-10-01T10:00:00.000Z',
			expectedAssignedMemberId: null,
		}),
		method: 'POST',
		path: `${base}/chores/${encodedId}/complete`,
		route: 'chores/[id]/complete/route.ts',
	},
	{
		type: 'expense.create',
		action: createQueuedExpense(expenseInput),
		method: 'POST',
		path: `${base}/expenses`,
		route: 'expenses/route.ts',
	},
	{
		type: 'expense.update',
		action: createQueuedExpenseUpdate({
			...expenseInput,
			expenseId: id,
			expectedUpdatedAt: '2026-10-01T09:00:00.000Z',
		}),
		method: 'PATCH',
		path: `${base}/expenses/${encodedId}`,
		route: 'expenses/[id]/route.ts',
	},
	{
		type: 'recurring.create',
		action: createQueuedRecurring({
			...expenseInput,
			intervalMonths: 1,
			nextDueAt: '2026-11-01T10:00:00.000Z',
		}),
		method: 'POST',
		path: `${base}/recurring-expenses`,
		route: 'recurring-expenses/route.ts',
	},
	{
		type: 'recurring.advance',
		action: advance({ recurringExpenseId: id }),
		method: 'PATCH',
		path: `${base}/recurring-expenses`,
		route: 'recurring-expenses/route.ts',
	},
];

for (const { type, action, method, path, route } of cases) {
	test(`${type} replays as ${method} ${path}`, () => {
		assert.equal(action.type, type);
		const request = getOfflineActionRequest(action);
		assert.equal(request.method, method);
		assert.equal(request.path, path);
	});

	test(`${type} targets a route that exports ${method}`, () => {
		const source = readFileSync(
			new URL(`../../app/api/wg/[code]/${route}`, import.meta.url),
			'utf8',
		);
		assert.match(source, new RegExp(`export (async function|const) ${method}\\b`));
	});
}

test('every offline action type has a replay case', () => {
	assert.deepEqual(cases.map((c) => c.type).sort(), Object.keys(offlineActionHandlers).sort());
});

test('null payload fields are dropped from announcement, absence and expense bodies', () => {
	const byType = (type: OfflineActionType) => {
		const found = cases.find((c) => c.type === type);
		assert.ok(found);
		return getOfflineActionRequest(found.action).body;
	};
	assert.equal('imageUrl' in byType('announcement.create'), false);
	assert.equal('reason' in byType('absence.create'), false);
	assert.equal('imageUrl' in byType('expense.create'), false);
});

test('recurring.advance sends expectedNextDueAt only when it is a string', () => {
	const due = '2026-11-01T10:00:00.000Z';
	assert.deepEqual(
		getOfflineActionRequest(advance({ recurringExpenseId: id, expectedRecurringNextDueAt: due }))
			.body,
		{ id, expectedNextDueAt: due },
	);
	for (const missing of [undefined, null, 5]) {
		assert.deepEqual(
			getOfflineActionRequest(
				advance({ recurringExpenseId: id, expectedRecurringNextDueAt: missing }),
			).body,
			{ id },
		);
	}
});
