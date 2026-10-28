// English settings: every tab renders English chrome at phone widths.
// Why: The settings screens are the only place a member sees account, access and data actions.

import { expect, type Locator, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
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

// German settings vocabulary; the shared list of expectNoGermanChrome has none of it. A word only
// matches when no letter touches it, so the plural 'Einladungen' needs its own entry.
const GERMAN_SETTINGS_WORDS = [
	'Abbrechen',
	'Benachrichtigungen',
	'Datenexport',
	'Einladung',
	'Einladungen',
	'Gefahrenzone',
	'Konto',
	'Löschen',
	'Rechtliches',
];
const GERMAN_SETTINGS_PATTERN = new RegExp(
	GERMAN_SETTINGS_WORDS.map((word) => `(?<![\\p{L}])${word}(?![\\p{L}])`).join('|'),
	'u',
);

async function expectNoGermanSettingsText(scope: Locator): Promise<void> {
	const text = (await scope.evaluate((element) => element.textContent)) ?? '';
	expect(GERMAN_SETTINGS_PATTERN.exec(text)?.[0], 'German settings word in English text').toBe(
		undefined,
	);
}

/** Opens a destructive dialog from the Access tab, checks its English copy and closes it again. */
async function checkDialog(page: Page, trigger: string, title: string): Promise<void> {
	await page.getByRole('button', { name: trigger }).click();
	const dialog = page.getByRole('alertdialog', { name: title });
	await expect(dialog).toBeVisible();
	const cancel = dialog.getByRole('button', { name: 'Cancel' });
	await expect(cancel).toBeVisible();
	await expectNoGermanSettingsText(dialog);
	await cancel.click();
	await expect(dialog).toBeHidden();
}

const MEMBER_ME = { id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, active: true };

/** Serves a members list in which the viewer is admin, one member can take over and one has moved out. */
async function mockAdminMembers(page: Page, members: unknown[]): Promise<void> {
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { members, viewerIsAdmin: true } })
			: route.fallback(),
	);
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
					await expectNoGermanSettingsText(page.locator('main'));
					await expectNoGermanChrome(page);
					if (width === 320) await expectNoHorizontalOverflow(page);
					await page.goto('about:blank');
				}
			});
		}
	}

	test('admin dialogs and the danger zone render English', async ({ context, page, baseURL }) => {
		test.setTimeout(180_000);
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await page.setViewportSize({ width: 320, height: 780 });
		await setupMember(page);
		await mockAdminMembers(page, [
			MEMBER_ME,
			{ id: 'fixture-other-member', name: 'Mira', active: true },
			{ id: 'fixture-moved-out', name: 'Jonas', active: false, hasAccount: false },
		]);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Danger zone', level: 2 })).toBeVisible({
			timeout: 60_000,
		});
		await checkDialog(page, 'Hand over admin: Mira', 'Hand over the admin role?');
		await checkDialog(page, 'Reactivate: Jonas', 'Reactivate Jonas anyway?');
		await checkDialog(page, 'Delete the whole flat for everyone', 'Delete flat permanently?');
		await checkDialog(page, 'Delete account permanently', 'Delete account permanently?');
		await expectNoGermanSettingsText(page.locator('main'));
	});

	test('the error boundary renders English', async ({ context, page, baseURL }) => {
		test.setTimeout(180_000);
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		// An object as member name fails the render, which lands in the route's error.tsx.
		await mockAdminMembers(page, [{ ...MEMBER_ME, name: {} }]);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen#zugang`);
		await expect(page.getByText('Settings could not be loaded right now')).toBeVisible({
			timeout: 60_000,
		});
		await expect(
			page.getByText('Something went wrong in settings.', { exact: false }),
		).toBeVisible();
	});
});
