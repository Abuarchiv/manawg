import { describe, expect, it } from 'vitest';
import {
	getChorePlanHealth,
	getChoreRepairHint,
	getChoreStatus,
	suggestChoreAssignee,
} from './chore-status';

const NOW = new Date('2026-05-18T12:00:00.000Z').getTime();

describe('getChoreStatus', () => {
	it('marks chores due yesterday as open plan gaps', () => {
		const status = getChoreStatus('2026-05-17T12:00:00.000Z', NOW);

		expect(status.state).toBe('overdue');
		expect(status.tone).toBe('overdue');
		expect(status.label).toBe('1 T. überfällig');
		expect(status.detail).toBe('Lücke im Plan: seit 1 Tag offen');
		expect(status.actionLabel).toBe('Nachholen');
		expect(status.overdueDays).toBe(1);
		expect(status.escalated).toBe(false);
	});

	it('escalates gaps after 48 hours', () => {
		const status = getChoreStatus('2026-05-16T12:00:00.000Z', NOW);

		expect(status.state).toBe('overdue');
		expect(status.overdueDays).toBe(2);
		expect(status.escalated).toBe(true);
		expect(status.escalationLabel).toBe('Bitte klären');
		expect(status.detail).toBe('Lücke im Plan: seit 2 Tagen offen · bitte nachholen oder tauschen');
	});

	it('keeps chores due today visible without calling them gaps', () => {
		const status = getChoreStatus('2026-05-18T08:00:00.000Z', NOW);

		expect(status).toEqual({
			state: 'due',
			tone: 'soon',
			label: 'heute fällig',
			detail: 'Heute offen',
			actionLabel: 'Erledigt',
			overdueDays: 0,
			escalated: false,
			escalationLabel: null,
		});
	});

	it('describes future chores by days until due', () => {
		const status = getChoreStatus('2026-05-21T12:00:00.000Z', NOW);

		expect(status).toEqual({
			state: 'planned',
			tone: 'soon',
			label: 'in 3 T.',
			detail: 'Geplant',
			actionLabel: 'Erledigt',
			overdueDays: 0,
			escalated: false,
			escalationLabel: null,
		});
	});

	it('keeps invalid due dates readable instead of leaking NaN labels', () => {
		expect(getChoreStatus('broken', NOW)).toEqual({
			state: 'unknown',
			tone: 'soon',
			label: 'Datum prüfen',
			detail: 'Fälligkeit ist unklar',
			actionLabel: 'Erledigt',
			overdueDays: 0,
			escalated: false,
			escalationLabel: null,
		});
	});
});

describe('suggestChoreAssignee', () => {
	it('chooses the member with the fewest open gaps and upcoming chores', () => {
		expect(
			suggestChoreAssignee({
				members: [
					{ id: 'm1', name: 'Ava' },
					{ id: 'm2', name: 'Ben' },
					{ id: 'm3', name: 'Cem' },
				],
				chores: [
					{ assignedMemberId: 'm1', nextDueAt: '2026-05-16T12:00:00.000Z' },
					{ assignedMemberId: 'm1', nextDueAt: '2026-05-19T12:00:00.000Z' },
					{ assignedMemberId: 'm2', nextDueAt: '2026-05-18T12:00:00.000Z' },
				],
				now: NOW,
			}),
		).toEqual({ id: 'm3', name: 'Cem' });
	});
});

describe('getChoreRepairHint', () => {
	it('prioritizes assigning ownerless chores', () => {
		expect(
			getChoreRepairHint({ assignedMemberId: null, nextDueAt: '2026-05-18T12:00:00.000Z' }, NOW),
		).toEqual({
			tone: 'danger',
			title: 'Niemand zuständig',
			action: 'Person zuweisen',
		});
	});

	it('suggests repair for escalated overdue chores', () => {
		expect(
			getChoreRepairHint({ assignedMemberId: 'm1', nextDueAt: '2026-05-16T12:00:00.000Z' }, NOW),
		).toEqual({
			tone: 'danger',
			title: 'Lücke seit 2 Tagen',
			action: 'Neu zuweisen oder nachholen',
		});
	});
});

describe('getChorePlanHealth', () => {
	it('summarizes open tasks, gaps, and next due task', () => {
		const health = getChorePlanHealth(
			[
				{ nextDueAt: '2026-05-16T12:00:00.000Z' },
				{ nextDueAt: '2026-05-18T08:00:00.000Z' },
				{ nextDueAt: '2026-05-21T12:00:00.000Z' },
			],
			NOW,
		);

		expect(health).toEqual({
			total: 3,
			gaps: 1,
			dueToday: 1,
			escalated: 1,
			nextLabel: '2 T. überfällig',
		});
	});

	it('keeps plan health readable when the next due date is invalid', () => {
		expect(getChorePlanHealth([{ nextDueAt: 'broken' }], NOW)).toEqual({
			total: 1,
			gaps: 0,
			dueToday: 0,
			escalated: 0,
			nextLabel: 'Datum prüfen',
		});
	});

	it('describes an empty plan', () => {
		expect(getChorePlanHealth([], NOW)).toEqual({
			total: 0,
			gaps: 0,
			dueToday: 0,
			escalated: 0,
			nextLabel: 'keine',
		});
	});
});
