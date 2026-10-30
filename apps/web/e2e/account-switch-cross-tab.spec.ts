import { expect, type Page, test } from '@playwright/test';
import { buildDraftKey } from '../src/core/offline/drafts';
import { FIXTURE_AUTH_USER_ID } from '../src/fixtures/data';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const OTHER_MEMBER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const OTHER_AUTH_USER_ID = 'fixture-auth-user-b';

async function triggerVisibleRefresh(page: Page): Promise<void> {
	await page.evaluate(() => {
		Object.defineProperty(document, 'hidden', { configurable: true, value: false });
		document.dispatchEvent(new Event('visibilitychange'));
	});
}

test.describe('Kontowechsel zwischen Tabs', () => {
	skipUnlessFixtures();

	test('hides the previous flat when the new membership check ends in a 503', async ({
		page,
		context,
	}) => {
		test.setTimeout(120_000);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		await expect(page.getByLabel('Artikel-Name')).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('manawg_account')))
			.toBe(FIXTURE_AUTH_USER_ID);

		const otherTab = await context.newPage();
		await otherTab.goto('/login');
		await otherTab.bringToFront();
		let memberLookups = 0;
		let oldLookupStarted = (): void => {};
		let releaseOldLookup = (): void => {};
		const oldLookupStartedPromise = new Promise<void>((resolve) => {
			oldLookupStarted = resolve;
		});
		const oldLookupGate = new Promise<void>((resolve) => {
			releaseOldLookup = resolve;
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, async (route) => {
			if (
				route.request().method() !== 'GET' ||
				new URL(route.request().url()).pathname !== `/api/wg/${FIXTURE_WG.shareCode}`
			) {
				return route.continue();
			}
			memberLookups += 1;
			if (memberLookups === 1) {
				oldLookupStarted();
				await oldLookupGate;
				await route.fulfill({
					json: {
						currentMember: {
							memberId: FIXTURE_WG.memberId,
							name: FIXTURE_WG.memberName,
							authUserId: FIXTURE_AUTH_USER_ID,
						},
					},
				});
				return;
			}
			await route.fulfill({ status: 503, json: { error: 'server_error' } });
		});

		await triggerVisibleRefresh(page);
		await oldLookupStartedPromise;
		const oldLookupResponse = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === `/api/wg/${FIXTURE_WG.shareCode}` &&
				response.status() === 200,
		);
		try {
			await otherTab.evaluate((newUserId) => {
				localStorage.setItem('manawg_account', newUserId);
			}, OTHER_AUTH_USER_ID);
			await expect.poll(() => memberLookups).toBe(2);
			await expect(
				page.getByText('Deine WG konnte nicht geladen werden. Bitte versuche es erneut.'),
			).toBeVisible();
		} finally {
			releaseOldLookup();
		}
		await oldLookupResponse;
		await expect(
			page.getByText('Deine WG konnte nicht geladen werden. Bitte versuche es erneut.'),
		).toBeVisible();
		await expect(page.getByLabel('Artikel-Name')).toHaveCount(0);
	});

	test('separates form drafts on an account switch but keeps them on a rename', async ({
		page,
		context,
	}) => {
		test.setTimeout(120_000);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
		await dismissOnboarding(page);
		await expect(page.getByLabel('Artikel-Name')).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('manawg_account')))
			.toBe(FIXTURE_AUTH_USER_ID);

		const draftKeyA = buildDraftKey(FIXTURE_WG.shareCode, FIXTURE_WG.memberId, 'shopping');
		const draftKeyB = buildDraftKey(FIXTURE_WG.shareCode, OTHER_MEMBER_ID, 'shopping');
		await page.getByLabel('Artikel-Name').fill('Nur Konto A');
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').name, draftKeyA),
			)
			.toBe('Nur Konto A');

		const otherTab = await context.newPage();
		await otherTab.goto('/login');
		await otherTab.bringToFront();
		let memberName = 'Bea';
		let memberLookups = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			await route.fulfill({
				json: {
					members: [{ id: OTHER_MEMBER_ID, name: memberName, active: true }],
					viewerIsAdmin: false,
				},
			});
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, async (route) => {
			if (
				route.request().method() !== 'GET' ||
				new URL(route.request().url()).pathname !== `/api/wg/${FIXTURE_WG.shareCode}`
			) {
				return route.continue();
			}
			memberLookups += 1;
			await route.fulfill({
				json: {
					currentMember: {
						memberId: OTHER_MEMBER_ID,
						name: memberName,
						authUserId: OTHER_AUTH_USER_ID,
					},
				},
			});
		});

		await page.bringToFront();
		await triggerVisibleRefresh(page);
		await expect.poll(() => memberLookups).toBe(1);
		const itemName = page.getByLabel('Artikel-Name');
		await expect(itemName).toHaveValue('');
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').name, draftKeyB),
			)
			.toBe('');
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').name, draftKeyA),
			)
			.toBe('Nur Konto A');

		await itemName.fill('Nur Konto B');
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').name, draftKeyB),
			)
			.toBe('Nur Konto B');

		memberName = 'Bea umbenannt';
		await otherTab.bringToFront();
		await page.bringToFront();
		await triggerVisibleRefresh(page);
		await expect.poll(() => memberLookups).toBe(2);
		await expect(itemName).toHaveValue('Nur Konto B');
		await expect
			.poll(() =>
				page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').name, draftKeyB),
			)
			.toBe('Nur Konto B');
	});
});
