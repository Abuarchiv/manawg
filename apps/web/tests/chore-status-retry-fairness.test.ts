// Chores: Berlin-day status, recurring-advance retry and fairness.
// Why: Cache and retry paths must not resurrect removed state.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as offlineClient from '../src/core/offline/offline-client';
import { buildChoreFairness } from '../src/features/chores/chore-fairness';
import {
	choreNeedsRepair,
	getChoreStatus,
	groupChoresForPlan,
} from '../src/features/chores/chore-status';

describe('chore status', () => {
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

	test('escalates a chore from its second overdue day', () => {
		const now = Date.parse('2026-09-05T12:00:00+02:00');

		assert.equal(getChoreStatus('2026-09-04T12:00:00+02:00', now).escalated, false);
		assert.equal(getChoreStatus('2026-09-03T12:00:00+02:00', now).escalated, true);
	});

	test('groups chores by the calendar-day thresholds of the plan', () => {
		const now = Date.parse('2026-09-05T12:00:00+02:00');
		const chore = (id: string, assignedMemberId: string, nextDueAt: string) => ({
			id,
			assignedMemberId,
			nextDueAt,
		});
		const groups = groupChoresForPlan(
			[
				chore('own-tomorrow', 'me', '2026-09-06T12:00:00+02:00'),
				chore('other-in-7', 'other', '2026-09-12T12:00:00+02:00'),
				chore('other-in-8', 'other', '2026-09-13T12:00:00+02:00'),
				chore('other-invalid', 'other', 'not-a-date'),
			],
			'me',
			now,
		);

		assert.deepEqual(
			groups.map((group) => [group.key, group.chores.map((c) => c.id)]),
			[
				['mine', ['own-tomorrow']],
				['week', ['other-in-7']],
				['later', ['other-in-8', 'other-invalid']],
			],
		);
	});
});

describe('chore recurring retry and fairness', () => {
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

test('a chore two days overdue needs someone to step in, one day overdue does not yet', () => {
	const now = Date.parse('2026-09-05T12:00:00+02:00');
	const chore = (nextDueAt: string) => ({ assignedMemberId: 'm', nextDueAt });
	assert.equal(choreNeedsRepair(chore('2026-09-04T12:00:00+02:00'), now), false);
	assert.equal(choreNeedsRepair(chore('2026-09-03T12:00:00+02:00'), now), true);
});

test("a flatmate's overdue chore is listed as still open, not as upcoming", () => {
	const now = Date.parse('2026-09-05T12:00:00+02:00');
	const groups = groupChoresForPlan(
		[{ id: 'c1', assignedMemberId: 'other', nextDueAt: '2026-09-04T12:00:00+02:00' }],
		'me',
		now,
	);
	assert.deepEqual(
		groups.map((g) => g.key),
		['overdue'],
	);
});
