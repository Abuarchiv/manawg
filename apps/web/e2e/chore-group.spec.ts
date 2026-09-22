import { expect, test } from '@playwright/test';
import { getChoreGroup } from '../src/features/chores/chore-status';

const now = Date.parse('2026-09-22T10:00:00+02:00');
const inDays = (days: number) => new Date(now + days * 86_400_000).toISOString();

test('groups chores by ownership and due date', () => {
	expect(getChoreGroup({ assignedMemberId: 'me', nextDueAt: inDays(1) }, 'me', now)).toBe('mine');
	expect(getChoreGroup({ assignedMemberId: 'me', nextDueAt: inDays(-3) }, 'me', now)).toBe('mine');
	expect(getChoreGroup({ assignedMemberId: 'me', nextDueAt: inDays(4) }, 'me', now)).toBe('week');
	expect(getChoreGroup({ assignedMemberId: 'x', nextDueAt: inDays(-1) }, 'me', now)).toBe(
		'overdue',
	);
	expect(getChoreGroup({ assignedMemberId: null, nextDueAt: inDays(0) }, 'me', now)).toBe('week');
	expect(getChoreGroup({ assignedMemberId: 'x', nextDueAt: inDays(9) }, 'me', now)).toBe('later');
});
