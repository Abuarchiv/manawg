// English data export: the summary labels, the CSV download and the locale the request carries.
// Why: The CSV follows the downloader's locale, so the request must carry the language cookie.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const SECTION_LABELS = [
	'Members',
	'Expenses',
	'Settled payments',
	'Fixed costs',
	'Shopping',
	'Cleaning rota',
	'Completed cleaning tasks',
	'Supplies',
	'Time away',
	'Noticeboard',
	'Noticeboard replies',
	'Events',
	'Chat',
	'Flat changes',
];

test.describe('data export in English', () => {
	skipUnlessFixtures();

	for (const colorScheme of ['light', 'dark'] as const) {
		for (const width of [320, 390]) {
			test(`summary and CSV download at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(120_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#daten`);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByText('Data export', { exact: true }).first()).toBeVisible({
					timeout: 60_000,
				});
				const select = page.getByLabel('CSV section');
				await expect(select.locator('option')).toHaveText(SECTION_LABELS);
				await expect(page.getByRole('button', { name: 'Export flat data as JSON' })).toBeVisible();

				const csvRequest = page.waitForRequest((request) =>
					request.url().includes('format=csv&section=expenses'),
				);
				const download = page.waitForEvent('download');
				await page.getByRole('button', { name: 'Export Expenses as CSV' }).click();
				const request = await csvRequest;
				expect((await request.allHeaders()).cookie).toContain('manawg_locale=en');
				expect((await download).suggestedFilename()).toBe(`${FIXTURE_WG.shareCode}-expenses.csv`);
				await expect(
					page.getByText(
						'Expenses export started. The CSV file is saved to your browser downloads.',
					),
				).toBeVisible();

				await expectNoGermanChrome(page);
				if (width === 320) await expectNoHorizontalOverflow(page);
			});
		}
	}
});
