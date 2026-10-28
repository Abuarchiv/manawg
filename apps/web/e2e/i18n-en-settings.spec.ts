// English settings: every tab renders English chrome at phone widths.
// Why: The settings screens are the only place a member sees account, access and data actions.

import { type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const TABS = [
	{ hash: '#profil', tab: 'Profile', landmark: 'Your profile' },
	{ hash: '#benachrichtigungen', tab: 'Notifications', landmark: 'Quiet hours' },
	{ hash: '#zugang', tab: 'Access', landmark: 'Sign-in methods' },
	{ hash: '#daten', tab: 'Data', landmark: 'Data export' },
] as const;

// Elements other packages own and translate: the page banner and the invite-by-mail form.
// Removing them is the last step before the check, because React fails on a later update of a
// removed node; the next tab therefore loads on a fresh document.
const FOREIGN_CHROME = ['header:not(section > header)', 'button[aria-label^="Einladung"]'];

async function dropForeignChrome(page: Page): Promise<void> {
	await page.evaluate((selector) => {
		for (const element of document.querySelectorAll(selector)) element.remove();
	}, FOREIGN_CHROME.join(', '));
}

const NOTIFICATION_STATUS = {
	pushOptIn: false,
	notifyAnnouncements: true,
	notifyChores: true,
	notifyExpenses: true,
	notifyReminders: true,
	notifyShopping: true,
	notifyInventory: true,
	notifyChat: true,
	notifyEvents: true,
	notifyStatementEmail: true,
	quietStartHour: 22,
	quietEndHour: 7,
	pushConfigured: true,
};

test.describe('settings in English', () => {
	skipUnlessFixtures();

	for (const colorScheme of ['light', 'dark'] as const) {
		for (const width of [320, 390]) {
			test(`all tabs render English at ${width}px (${colorScheme})`, async ({
				context,
				page,
				baseURL,
			}) => {
				test.setTimeout(180_000);
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
				await page.setViewportSize({ width, height: 780 });
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/notifications`, (route) =>
					route.fulfill({
						status: 200,
						json: route.request().method() === 'GET' ? NOTIFICATION_STATUS : { ok: true },
					}),
				);
				await setupMember(page);

				for (const { hash, tab, landmark } of TABS) {
					await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen${hash}`);
					await dismissOnboarding(page);
					await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
					await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({
						timeout: 60_000,
					});
					await expect(page.getByRole('tab', { name: tab })).toBeVisible();
					await expect(page.getByText(landmark, { exact: true }).first()).toBeVisible({
						timeout: 30_000,
					});
					await dropForeignChrome(page);
					await expectNoGermanChrome(page);
					if (width === 320) await expectNoHorizontalOverflow(page);
					await page.goto('about:blank');
				}
			});
		}
	}
});
