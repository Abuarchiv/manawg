// Language resolution in the app shell.
// Why: The cookie picks English before any screen is translated, and German stays the default.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

test.describe('shell language', () => {
	test('cookie en renders an English shell', async ({ context, page, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await page.goto('/neu');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		await expect(page.locator('a.skip-link')).toHaveText('Skip to main content');
		await expectNoHorizontalOverflow(page);
	});

	test('without a cookie the shell is German', async ({ page }) => {
		await page.goto('/neu');
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(page.locator('a.skip-link')).toHaveText('Zum Hauptinhalt springen');
	});

	test('the German chrome check finds German words', async ({ page }) => {
		await page.goto('/neu');
		await expect(expectNoGermanChrome(page)).rejects.toThrow();
	});
});

test.describe('client provider', () => {
	skipUnlessFixtures();

	test('a client component renders English catalog messages', async ({
		context,
		page,
		baseURL,
	}) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses*`, (route) =>
			route.fulfill({ status: 503, json: { error: 'service_unavailable' } }),
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/abrechnung`);
		await dismissOnboarding(page);
		await expect(
			page.getByText('Expenses could not be loaded: Try again in a moment.'),
		).toBeVisible();
	});
});
