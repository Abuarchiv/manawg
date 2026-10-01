import { expect, test } from '@playwright/test';
import { getChoreStatus } from '../src/features/chores/chore-status';

test('uses Berlin calendar days instead of rounding elapsed hours', () => {
	const now = Date.parse('2026-09-05T15:30:00+02:00');

	expect(getChoreStatus('2026-09-06T00:10:00+02:00', now)).toMatchObject({
		state: 'planned',
		label: 'morgen',
	});
	expect(getChoreStatus('2026-09-04T00:10:00+02:00', now)).toMatchObject({
		state: 'overdue',
		overdueDays: 1,
		label: 'seit 1 T. offen',
	});
});
