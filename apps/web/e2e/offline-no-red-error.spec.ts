// Offline with data on screen: Ausgaben, Fixkosten, Pinnwand and Aktivität keep their rows and
// show no red load error; only the offline bar speaks. Without any data the error stays.
// Why: a banner above data that loaded fine reads as lost data on the most used screens.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

const base = `/wg/${FIXTURE_WG.shareCode}`;
const PAGES = [
	{ name: 'Ausgaben', path: 'expenses', api: '/expenses' },
	{ name: 'Fixkosten', path: 'recurring', api: '/recurring-expenses' },
	{ name: 'Pinnwand', path: 'pinboard', api: '/announcements' },
	{ name: 'Aktivität', path: 'activity', api: '/activity?' },
] as const;

test.describe('offline without a red load error', () => {
	skipUnlessFixtures();
	test.use({ hasTouch: true, isMobile: true });

	for (const { name, path, api } of PAGES) {
		test(`${name} keeps its data and shows only the offline bar`, async ({ context, page }) => {
			await setupMember(page);
			const loaded = page.waitForResponse(
				(res) => res.url().includes(`/api${base}${api}`) && res.ok(),
			);
			await navigateToFeature(page, `${base}/${path}`);
			await loaded;
			await page.waitForLoadState('networkidle');
			const loadError = page.getByRole('alert').filter({ hasText: 'nicht geladen werden' });
			await expect(loadError).toHaveCount(0);

			// A refresh that fails: the focus event starts one, the offline context kills it.
			await context.setOffline(true);
			const failed = page.waitForEvent('requestfailed', (req) =>
				req.url().includes(`/api${base}${api}`),
			);
			await page.evaluate(() => {
				window.dispatchEvent(new Event('offline'));
				window.dispatchEvent(new Event('focus'));
			});
			await failed;
			await expect(page.locator('[data-offline-banner]')).toBeVisible();
			await page.waitForTimeout(300);
			await expect(loadError).toHaveCount(0);
			await expect(page.getByRole('button', { name: /erneut laden/ })).toHaveCount(0);
		});
	}

	test('a cold load that cannot reach the server still shows the error', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api${base}/expenses*`, (route) => route.abort('failed'));
		await navigateToFeature(page, `${base}/expenses`);
		await expect(
			page.getByRole('alert').filter({ hasText: 'nicht geladen werden' }).first(),
		).toBeVisible();
	});
});
