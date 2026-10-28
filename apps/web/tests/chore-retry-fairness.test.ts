// Chores: Berlin-day status, recurring-advance retry and fairness regressions.
// Why: Cache and retry paths must not resurrect removed state.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as offlineClient from '../src/core/offline/offline-client';
import { buildChoreFairness } from '../src/features/chores/chore-fairness';
import { getChoreStatus } from '../src/features/chores/chore-status';

describe('chores retry', () => {
	test('uses Berlin calendar days instead of rounding elapsed hours', () => {
		const now = Date.parse('2026-09-05T15:30:00+02:00');

		assert.partialDeepStrictEqual(getChoreStatus('2026-09-06T00:10:00+02:00', now), {
			state: 'planned',
			label: { key: 'chores.status.tomorrow' },
		});
		assert.partialDeepStrictEqual(getChoreStatus('2026-09-04T00:10:00+02:00', now), {
			state: 'overdue',
			overdueDays: 1,
			label: { key: 'chores.status.overdue', values: { days: 1 } },
		});
	});
});

describe('recurring retry and fairness', () => {
	const NOW = Date.parse('2026-09-19T12:00:00.000Z');

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

		assert.partialDeepStrictEqual(retry, {
			type: 'recurring.advance',
			payload: {
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			},
		});
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

		assert.partialDeepStrictEqual(fairness.rows[0], { openGapCount: 2, score: 10 });
	});
});
