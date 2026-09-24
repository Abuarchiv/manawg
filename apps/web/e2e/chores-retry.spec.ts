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

test('requires a WG member for chores and absences API data', async ({ request }) => {
	const [choresResponse, absencesResponse] = await Promise.all([
		request.get('/api/wg/MTE8PZAT/chores', { timeout: 120_000 }),
		request.get('/api/wg/MTE8PZAT/absences', { timeout: 120_000 }),
	]);

	expect(choresResponse.status()).toBe(401);
	expect(absencesResponse.status()).toBe(401);
	await expect(choresResponse.json()).resolves.toMatchObject({ error: 'auth_required' });
	await expect(absencesResponse.json()).resolves.toMatchObject({
		error: 'auth_required',
	});
});
