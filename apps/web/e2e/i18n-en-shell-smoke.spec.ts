// Language resolution in the app shell.
// Why: The cookie picks English before any screen is translated, and German stays the default.

import { expect, test } from '@playwright/test';
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
