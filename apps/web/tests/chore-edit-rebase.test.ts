import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chore } from '../src/features/chores/components/chore-types.ts';

const { rebaseChoreEdit } = await import('../src/features/chores/chore-edit.ts');

const base: Chore = {
	id: 'c1',
	title: 'Muell',
	intervalDays: 7,
	recurrenceType: 'days',
	nextDueAt: '2026-10-05T10:00:00.000Z',
	assignedMemberId: 'm1',
	lastCompletedAt: null,
	lastCompletedByName: null,
	openGapCountForAssignee: 0,
	updatedAt: '2026-10-01T08:00:00.000Z',
};
const latest: Chore = {
	...base,
	title: 'Restmuell',
	assignedMemberId: 'm2',
	intervalDays: 14,
	nextDueAt: '2026-10-12T10:00:00.000Z',
	updatedAt: '2026-10-01T09:00:00.000Z',
};
const untouched = {
	title: base.title,
	assigned: 'm1',
	dueDay: '2026-10-05',
	interval: 7,
	recurrenceType: 'days' as const,
};

test('untouched chore fields follow the latest version', () => {
	assert.deepEqual(rebaseChoreEdit(base, latest, untouched), {
		title: 'Restmuell',
		assigned: 'm2',
		dueDay: '2026-10-12',
		interval: 14,
		recurrenceType: 'days',
	});
});

test('touched chore fields keep what was typed', () => {
	const typed = { ...untouched, title: 'Bad putzen', assigned: '', interval: 1 };
	const rebased = rebaseChoreEdit(base, latest, typed);
	assert.equal(rebased.title, 'Bad putzen');
	assert.equal(rebased.assigned, '');
	assert.equal(rebased.interval, 1);
	assert.equal(rebased.dueDay, '2026-10-12');
});
