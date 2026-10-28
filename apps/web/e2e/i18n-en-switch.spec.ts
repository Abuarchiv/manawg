// Language switch in the entry footer and the settings profile.
// Why: The device language is the default; a choice must persist across reloads, reach the account
// when signed in, go back to the device language via System, and stay usable at 320px.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const GROUP = 'Sprache / Language';
const SKIP_LINK = 'a.skip-link';

const switchGroup = (page: Page) => page.getByRole('group', { name: GROUP });
const localeCookie = async (page: Page) =>
	(await page.context().cookies()).find((c) => c.name === 'manawg_locale')?.value;
const accountPatch = (page: Page, locale: string) =>
	page.waitForRequest(
		(req) =>
			req.url().endsWith('/api/account') &&
			req.method() === 'PATCH' &&
			req.postDataJSON()?.locale === locale,
	);

test.describe('language switch in the entry footer', () => {
	test('English persists across reloads and German switches back', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(switchGroup(page).getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await switchGroup(page).getByRole('button', { name: 'English' }).click();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		await expect(page.locator(SKIP_LINK)).toHaveText('Skip to main content');
		expect(await localeCookie(page)).toBe('en');

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		await expect(switchGroup(page).getByRole('button', { name: 'English' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await switchGroup(page).getByRole('button', { name: 'Deutsch' }).click();
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		expect(await localeCookie(page)).toBe('de');
	});

	test('the cookie decides even when the account request fails', async ({ page }) => {
		await page.route('**/api/account', (route) => route.abort());
		await page.goto('/login');
		await switchGroup(page).getByRole('button', { name: 'English' }).click();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
	});

	test('the switch is disabled offline', async ({ context, page }) => {
		await page.goto('/login');
		await expect(switchGroup(page)).toBeVisible();
		await context.setOffline(true);
		await expect(switchGroup(page).getByRole('button', { name: 'English' })).toBeDisabled();
		await context.setOffline(false);
		await expect(switchGroup(page).getByRole('button', { name: 'English' })).toBeEnabled();
	});

	for (const width of [320, 390]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`fits ${width}px in ${colorScheme} mode`, async ({ browser, baseURL }) => {
				const context = await browser.newContext({
					viewport: { width, height: 780 },
					colorScheme,
					locale: 'de-DE',
					timezoneId: 'Europe/Berlin',
				});
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				const page = await context.newPage();
				await page.goto('/login');
				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(switchGroup(page)).toBeVisible();
				await expectNoHorizontalOverflow(page);
				await context.close();
			});
		}
	}
});

test.describe('browser language without a cookie', () => {
	test.describe('de-DE', () => {
		test.use({ locale: 'de-DE' });
		test('stays German', async ({ page }) => {
			await page.goto('/login');
			await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		});
	});

	test.describe('en-GB', () => {
		test.use({ locale: 'en-GB' });
		test('renders English', async ({ page }) => {
			await page.goto('/login');
			await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
			await expect(page.locator(SKIP_LINK)).toHaveText('Skip to main content');
		});
	});

	test.describe('es-ES, a language without a translation', () => {
		test.use({ locale: 'es-ES' });
		test('falls back to English', async ({ page }) => {
			await page.goto('/login');
			await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		});
	});
});

test.describe('language switch in the settings profile', () => {
	skipUnlessFixtures();

	test('signed in, the choice is sent to the account and persists', async ({ page }) => {
		test.setTimeout(120_000);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings`);
		await dismissOnboarding(page);
		await expect(switchGroup(page)).toBeVisible({ timeout: 60_000 });

		const request = accountPatch(page, 'en');
		await switchGroup(page).getByRole('button', { name: 'English' }).click();
		await request;
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');

		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		await expect(switchGroup(page).getByRole('button', { name: 'English' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	test('System drops the choice and follows the device language again', async ({
		browser,
		baseURL,
	}) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		const page = await context.newPage();
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings`);
		await dismissOnboarding(page);
		await expect(switchGroup(page).getByRole('button', { name: 'English' })).toHaveAttribute(
			'aria-pressed',
			'true',
			{ timeout: 60_000 },
		);

		const request = accountPatch(page, 'de');
		await switchGroup(page).getByRole('button', { name: 'System' }).click();
		await request;
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		expect(await localeCookie(page)).toBeUndefined();
		await expect(switchGroup(page).getByRole('button', { name: 'System' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await context.close();
	});

	test.describe('signed in without a choice', () => {
		test.use({ locale: 'en-GB' });
		test('the account takes the device language for push and mail', async ({ page }) => {
			test.setTimeout(120_000);
			await setupMember(page);
			const request = accountPatch(page, 'en');
			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}`);
			await request;
			await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
		});
	});

	for (const width of [320, 390]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`settings fit ${width}px in ${colorScheme} mode`, async ({ browser, baseURL }) => {
				test.setTimeout(120_000);
				const context = await browser.newContext({
					viewport: { width, height: 780 },
					colorScheme,
					locale: 'de-DE',
					timezoneId: 'Europe/Berlin',
				});
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				const page = await context.newPage();
				await setupMember(page);
				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/settings`);
				await dismissOnboarding(page);
				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(switchGroup(page)).toBeVisible({ timeout: 60_000 });
				await expectNoHorizontalOverflow(page);
				await context.close();
			});
		}
	}
});
