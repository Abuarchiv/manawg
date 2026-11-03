// Calendar edit conflict: after event_changed the open form carries the reloaded version.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const HOUR_MS = 60 * 60 * 1000;

function meeting() {
	const today = new Date();
	const startsAt = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 12),
	);
	return {
		id: 'meeting',
		title: 'WG-Meeting',
		description: null,
		startsAt: startsAt.toISOString(),
		endsAt: new Date(startsAt.getTime() + HOUR_MS).toISOString(),
		allDay: false,
		location: 'Küche',
		recurrence: null,
		wgId: FIXTURE_WG.id,
		createdByMemberId: FIXTURE_WG.memberId,
		createdAt: startsAt.toISOString(),
		updatedAt: '2026-10-01T08:00:00.000Z',
	};
}

test.describe('calendar edit conflict', () => {
	skipUnlessFixtures();

	test('a second save after event_changed sends the reloaded version and keeps the typed title', async ({
		page,
	}) => {
		const v1 = meeting();
		const v2 = { ...v1, location: 'Balkon', updatedAt: '2026-10-01T09:00:00.000Z' };
		let served = v1;
		const patchBodies: Array<Record<string, unknown>> = [];
		await setupMember(page);
		await mockUnreadCount(page, BASE);
		await page.route(`**${BASE}/events*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { events: [served] } })
				: route.fallback(),
		);
		await page.route(`**${BASE}/events/meeting`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			patchBodies.push(route.request().postDataJSON());
			if (patchBodies.length === 1) {
				served = v2;
				return route.fulfill({ status: 409, json: { error: 'event_changed' } });
			}
			return route.fulfill({ json: { event: { ...v2, title: 'WG-Abend' } } });
		});
		await page.route(`**${BASE}/chores*`, (route) => route.fulfill({ json: { chores: [] } }));
		await page.route(`**${BASE}/calendar-subscription*`, (route) =>
			route.fulfill({ json: { subscription: null } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/calendar`);
		await dismissOnboarding(page);

		await page.getByRole('tab', { name: 'Agenda' }).click();
		await page.getByRole('button', { name: 'WG-Meeting' }).first().click();
		const drawer = page.getByRole('dialog');
		await drawer.getByLabel('Titel', { exact: true }).fill('WG-Abend');
		await drawer.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(drawer.getByRole('alert')).toContainText(/inzwischen geändert/);
		await expect(drawer.getByLabel('Ort (optional)')).toHaveValue('Balkon');

		await drawer.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect.poll(() => patchBodies.length).toBe(2);
		expect(patchBodies[0]?.expectedUpdatedAt).toBe(v1.updatedAt);
		expect(patchBodies[1]).toMatchObject({
			title: 'WG-Abend',
			location: 'Balkon',
			expectedUpdatedAt: v2.updatedAt,
		});
		await expect(drawer).toBeHidden();
	});
});
