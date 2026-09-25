import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;

test('does not claim chores stayed visible when they also failed to load', async ({ page }) => {
	await setupMember(page);
	await page.route(`**${BASE}/dashboard`, (route) =>
		route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } }),
	);
	await page.route(`**${BASE}/events**`, (route) =>
		route.fulfill({ status: 500, json: { error: 'temporarily_unavailable' } }),
	);
	await page.route(`**${BASE}/chat/unread-count`, (route) =>
		route.fulfill({ status: 200, json: { count: 0, overflow: false } }),
	);
	await page.route(`**${BASE}/activity`, (route) =>
		route.fulfill({ status: 200, json: { items: [], reminders: [] } }),
	);

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
	await dismissOnboarding(page);

	await expect(
		page.getByText('Termine konnten nicht geladen werden.', { exact: true }),
	).toBeVisible();
	await expect(page.getByText('Putzplan-Aufgaben bleiben sichtbar', { exact: false })).toHaveCount(
		0,
	);
});
