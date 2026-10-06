import assert from 'node:assert/strict';
import test from 'node:test';

const { isRecurringBookingQueued, planTemplateSchedule } = await import(
	'../src/features/expenses/recurring-template-plan.ts'
);

const today = () => new Date('2026-01-31T11:00:00.000Z');

test('a new template starts today, anchors on that day and is due one interval later', () => {
	const plan = planTemplateSchedule({
		editingNextDueAt: null,
		queuedNextDueAt: null,
		pending: null,
		intervalMonths: 1,
		today,
	});
	assert.equal(plan.startsAt, '2026-01-31T11:00:00.000Z');
	assert.equal(plan.nextDueAt.getUTCMonth(), 1);
});

test('edits, queued edits and retries keep their due date', () => {
	assert.deepEqual(
		planTemplateSchedule({
			editingNextDueAt: '2026-03-01T11:00:00.000Z',
			queuedNextDueAt: null,
			pending: null,
			intervalMonths: 3,
			today,
		}),
		{ startsAt: null, nextDueAt: new Date('2026-03-01T11:00:00.000Z') },
	);
	const queued = Date.parse('2026-04-01T11:00:00.000Z');
	assert.deepEqual(
		planTemplateSchedule({
			editingNextDueAt: null,
			queuedNextDueAt: queued,
			pending: null,
			intervalMonths: 1,
			today,
		}),
		{ startsAt: null, nextDueAt: new Date(queued) },
	);
	assert.deepEqual(
		planTemplateSchedule({
			editingNextDueAt: null,
			queuedNextDueAt: null,
			pending: { anchorAt: '2025-12-31T11:00:00.000Z', nextDueAt: '2026-01-31T11:00:00.000Z' },
			intervalMonths: 1,
			today,
		}),
		{
			startsAt: '2025-12-31T11:00:00.000Z',
			nextDueAt: new Date('2026-01-31T11:00:00.000Z'),
		},
	);
});

test('a booking counts as queued only for the same template due date and member', () => {
	const target = { wgId: 'wg-1', shareCode: 'CODE', memberId: 'm1' };
	const template = { id: 'tpl', nextDueAt: '2026-02-01T00:00:00.000Z' };
	const action = {
		id: 'expense:CODE:1:internet',
		type: 'expense.create' as const,
		shareCode: 'CODE',
		memberId: 'm1',
		createdAt: '2026-01-31T00:00:00.000Z',
		payload: { recurringExpenseId: 'tpl', expectedRecurringNextDueAt: template.nextDueAt },
	};
	assert.equal(isRecurringBookingQueued([action], target, template), true);
	assert.equal(
		isRecurringBookingQueued([action], target, { ...template, nextDueAt: '2026-03-01' }),
		false,
	);
	assert.equal(isRecurringBookingQueued([{ ...action, memberId: 'm2' }], target, template), false);
	assert.equal(isRecurringBookingQueued([{ ...action, wgId: 'other' }], target, template), false);
});
