// Chore domain rules: Berlin calendar-day status, recurring retries, activity scopes and fairness.
// Fair rotation and calendar-day maths regress silently without explicit cases.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ActivityItem } from '../src/composition/activity';
import { filterActivityByScope } from '../src/composition/activity-views';
import * as offlineClient from '../src/core/offline/offline-client';
import { buildChoreFairness } from '../src/features/chores/chore-fairness';
import { getChoreStatus } from '../src/features/chores/chore-status';
import { assertMatchObject } from './support/match-object';
describe('chores retry', () => {
	test('uses Berlin calendar days instead of rounding elapsed hours', () => {
		const now = Date.parse('2026-09-05T15:30:00+02:00');

		assertMatchObject(getChoreStatus('2026-09-06T00:10:00+02:00', now), {
			state: 'planned',
			label: 'morgen',
		});
		assertMatchObject(getChoreStatus('2026-09-04T00:10:00+02:00', now), {
			state: 'overdue',
			overdueDays: 1,
			label: 'seit 1 T. offen',
		});
	});
});

describe('domain regressions (recurring retry, activity, fairness)', () => {
	const NOW = Date.parse('2026-09-19T12:00:00.000Z');

	function activity(id: string, text: string, completed: boolean): ActivityItem {
		return {
			id,
			kind: 'chore',
			timestamp: new Date(NOW).toISOString(),
			memberId: 'member-1',
			memberName: 'Abu',
			text,
			completed,
		} as ActivityItem;
	}

	test('retries a recurring advance carried by an expense action', () => {
		const retry = offlineClient.createRecurringAdvanceRetry(
			{
				id: 'queued-recurring',
				type: 'expense.create',
				shareCode: 'WGCODE',
				memberId: 'member-1',
				createdAt: new Date(NOW).toISOString(),
				payload: {
					recurringExpenseId: 'recurring-1',
					expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
				},
			},
			NOW,
		);

		assertMatchObject(retry, {
			type: 'recurring.advance',
			payload: {
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			},
		});
	});

	test('activity done and changes scopes respect chore completion state', () => {
		const items = [activity('open', 'Flur geplant', false), activity('done', 'Bad erledigt', true)];

		assert.deepEqual(
			filterActivityByScope(items, 'done', 'Abu', 'member-1').map((item) => item.id),
			['done'],
		);
		assert.deepEqual(
			filterActivityByScope(items, 'changes', 'Abu', 'member-1').map((item) => item.id),
			['open'],
		);
	});

	test('uses the API-repeated open-gap total once for an assignee', () => {
		const fairness = buildChoreFairness({
			members: [{ id: 'member-1', name: 'Abu' }],
			chores: [
				{
					assignedMemberId: 'member-1',
					openGapCountForAssignee: 2,
					nextDueAt: '2026-09-20T12:00:00.000Z',
				},
				{
					assignedMemberId: 'member-1',
					openGapCountForAssignee: 2,
					nextDueAt: '2026-09-20T12:00:00.000Z',
				},
			],
			now: NOW,
		});

		assertMatchObject(fairness.rows[0], { openGapCount: 2, score: 10 });
	});
});
