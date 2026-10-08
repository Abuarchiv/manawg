// Offline queue and client caching: drafts, cached fetch revisit, optimistic action rollback.
// Why: queued writes must replay once and failures must roll back visibly.

import { expect, test } from '@playwright/test';
import { isEmptyModuleDraft } from '../src/core/offline/drafts';
import { E2E_EXISTING_WG } from '../src/fixtures/data';
import { dismissOnboarding, navigateToFeature, setupMember } from './support/helpers';

test.describe('offline drafts', () => {
	const MEMBER = 'member-1';
	const emptyChoreDraft = {
		title: '',
		recurrenceType: 'days',
		intervalDays: 7,
		assignedMemberId: '',
		absenceMemberId: MEMBER,
		absenceStartDate: '',
		absenceEndDate: '',
		absenceReason: '',
		queueEditId: null,
	};

	test('an untouched Putzplan draft with absence fields counts as empty', () => {
		expect(isEmptyModuleDraft('chore', emptyChoreDraft, MEMBER)).toBe(true);
		expect(isEmptyModuleDraft('chore', { ...emptyChoreDraft, title: 'Bad' }, MEMBER)).toBe(false);
		expect(
			isEmptyModuleDraft('chore', { ...emptyChoreDraft, absenceReason: 'Urlaub' }, MEMBER),
		).toBe(false);
	});
});

test.describe('wg cached fetch', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	const SHARE_CODE = 'MTE8PZAT';
	const shoppingItems = [
		{
			id: 'shopping-oat-milk',
			addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			name: 'Ungesüßte Hafermilch',
			quantity: '1 Packung',
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-20T08:00:00.000Z',
		},
	];

	test('cached shopping content stays visible while a revisit is revalidating', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await setupMember(page);

		let shoppingReads = 0;
		let holdNextShoppingRead = false;
		let markSecondReadStarted: () => void = () => {};
		let releaseSecondRead: () => void = () => {};
		const secondReadStarted = new Promise<void>((resolve) => {
			markSecondReadStarted = resolve;
		});
		const secondReadGate = new Promise<void>((resolve) => {
			releaseSecondRead = resolve;
		});

		await page.route(`**/api/wg/${SHARE_CODE}/shopping*`, async (route) => {
			if (route.request().method() !== 'GET') return route.continue();
			shoppingReads += 1;
			if (holdNextShoppingRead) {
				holdNextShoppingRead = false;
				markSecondReadStarted();
				await secondReadGate;
			}
			return route.fulfill({ json: { items: shoppingItems } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}`, (route) =>
			route.fulfill({
				json: {
					wg: {
						id: E2E_EXISTING_WG.id,
						name: E2E_EXISTING_WG.name,
						shareCode: E2E_EXISTING_WG.shareCode,
						joiningEnabled: true,
						shareCodeRotatedAt: null,
						createdAt: '2026-09-20T08:00:00.000Z',
					},
					members: [
						E2E_EXISTING_WG.member,
						{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: '#0f766e' },
					],
					currentMember: {
						memberId: E2E_EXISTING_WG.member.id,
						name: E2E_EXISTING_WG.member.name,
					},
				},
			}),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/inventory*`, (route) =>
			route.fulfill({ json: { items: [], grouped: {} } }),
		);

		await navigateToFeature(page, `/wg/${SHARE_CODE}/vorraete`);
		await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible();
		await navigateToFeature(page, `/wg/${SHARE_CODE}/einkauf`);
		await dismissOnboarding(page);
		const item = page.getByRole('checkbox', { name: 'Ungesüßte Hafermilch erledigen' });
		await expect(item).toBeVisible();

		const inventoryLink = page.locator(
			`nav[aria-label="Haushalt"] a[href="/wg/${SHARE_CODE}/vorraete"]:visible`,
		);
		await inventoryLink.click();
		await expect(page).toHaveURL(new RegExp(`/wg/${SHARE_CODE}/vorraete$`));
		await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible();
		const shoppingLink = page.locator(
			`nav[aria-label="Haushalt"] a[href="/wg/${SHARE_CODE}/einkauf"]:visible`,
		);
		holdNextShoppingRead = true;
		await shoppingLink.click();
		await expect(page).toHaveURL(new RegExp(`/wg/${SHARE_CODE}/einkauf$`));
		await secondReadStarted;

		try {
			await expect(item).toBeVisible({ timeout: 250 });
		} finally {
			releaseSecondRead();
		}
		await expect(item).toBeVisible();
		expect(shoppingReads).toBeGreaterThanOrEqual(2);
	});

	test('a failed revisit refresh keeps the cached Putzplan and settles to a retryable error', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await setupMember(page);

		const chore = {
			id: 'chore-bath',
			title: 'Bad putzen',
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			assignedMemberId: E2E_EXISTING_WG.member.id,
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
		let choreReads = 0;
		await page.route(`**/api/wg/${SHARE_CODE}/chores`, (route) => {
			choreReads += 1;
			return choreReads === 1
				? route.fulfill({ json: { chores: [chore], monthCompletions: {} } })
				: route.fulfill({ status: 503, json: { error: 'server_error' } });
		});
		await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/inventory*`, (route) =>
			route.fulfill({ json: { items: [], grouped: {} } }),
		);

		await navigateToFeature(page, `/wg/${SHARE_CODE}/putzen`);
		await dismissOnboarding(page);
		const row = page.locator(`#chore-${chore.id}`);
		await expect(row).toBeVisible();

		await page
			.locator(`nav[aria-label="Haushalt"] a[href="/wg/${SHARE_CODE}/vorraete"]:visible`)
			.click();
		await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible();
		await page
			.locator(`nav[aria-label="Haushalt"] a[href="/wg/${SHARE_CODE}/putzen"]:visible`)
			.click();

		await expect(page.getByText('Putzplan konnte nicht geladen werden')).toBeVisible();
		await expect(row).toBeVisible();
		await expect(page.getByRole('button', { name: 'Putzplan erneut laden' })).toBeEnabled();
		await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
		expect(choreReads).toBeGreaterThanOrEqual(2);
	});

	test('revoked membership hides the WG shell after member refresh', async ({ page }) => {
		await setupMember(page);
		await page.route(`**/api/wg/${SHARE_CODE}/members`, (route) =>
			route.fulfill({ status: 401, json: { error: 'member_deactivated' } }),
		);
		await navigateToFeature(page, `/wg/${SHARE_CODE}`);

		await expect(
			page.getByText(
				'Du bist in dieser WG nicht (mehr) Mitglied, z. B. weil du ausgezogen bist oder entfernt wurdest.',
			),
		).toBeVisible();
		await expect(page.getByRole('link', { name: /Chat öffnen/ })).toHaveCount(0);
	});
});

test.describe('wg optimistic actions', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	const SHARE_CODE = 'MTE8PZAT';
	const CHORE_ID = 'chore-bath';

	test('failed chore completion rolls back the row and shows its dialog error', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
		await setupMember(page);

		const chore = {
			id: CHORE_ID,
			title: 'Bad putzen',
			intervalDays: 7,
			recurrenceType: 'days',
			nextDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			assignedMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			lastCompletedAt: null,
			lastCompletedByName: null,
			openGapCountForAssignee: 0,
		};
		let startFailure: () => void = () => {};
		let releaseFailure: () => void = () => {};
		const failureStarted = new Promise<void>((resolve) => {
			startFailure = resolve;
		});
		const failureGate = new Promise<void>((resolve) => {
			releaseFailure = resolve;
		});

		await page.route(`**/api/wg/${SHARE_CODE}/chores`, (route) =>
			route.fulfill({ json: { chores: [chore], monthCompletions: {} } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/absences`, (route) =>
			route.fulfill({ json: { absences: [] } }),
		);
		await page.route(`**/api/wg/${SHARE_CODE}/chores/${CHORE_ID}/complete`, async (route) => {
			startFailure();
			await failureGate;
			return route.fulfill({ status: 500, json: { error: 'completion_insert_failed' } });
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/putzen`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Als erledigt markieren: Bad putzen' }).click();
		await page.getByRole('button', { name: 'Erledigt bestätigen: Bad putzen' }).click();
		await failureStarted;

		const row = page.locator(`#chore-${CHORE_ID}`);
		try {
			await expect(row).toHaveCount(0);
		} finally {
			releaseFailure();
		}

		await expect(row).toBeVisible();
		await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText(
			'Erledigt-Aktion konnte nicht vollständig gespeichert werden: Lade den Plan neu und prüfe den Verlauf.',
		);
	});
});
