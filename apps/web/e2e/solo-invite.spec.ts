// The invitation stays one tap away while nobody else lives in the WG.
// Why: with the invite only on a dismissible Start card, a solo WG would never be asked again.

import { expect, type Page, test } from '@playwright/test';
import { E2E_CREATED_WG } from '../src/fixtures/data';
import {
	dismissOnboarding,
	EMPTY_DASHBOARD,
	FIXTURE_WG,
	mockDashboard,
	mockUnreadCount,
	navigateToFeature,
	SOLO_WG,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const SOLO_BASE = `/api/wg/${SOLO_WG.shareCode}`;
const DUO_BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const SOLO_TEXT = 'Du bist noch allein in der WG.';
const DAY_MS = 86_400_000;
const SOLO_KEY = `manawg:start-welcome-dismissed:${E2E_CREATED_WG.id}:${SOLO_WG.memberId}`;

async function mockEmptyLists(page: Page, base: string): Promise<void> {
	await page.route(`**${base}/expenses*`, (route) =>
		route.fulfill({ json: { expenses: [], payments: [] } }),
	);
	await page.route(`**${base}/shopping*`, (route) => route.fulfill({ json: { items: [] } }));
	await page.route(`**${base}/chores*`, (route) => route.fulfill({ json: { chores: [] } }));
	await mockDashboard(page, base, EMPTY_DASHBOARD);
	await mockUnreadCount(page, base);
}

async function open(page: Page, shareCode: string, path = ''): Promise<void> {
	await navigateToFeature(page, `/wg/${shareCode}${path}`);
	await dismissOnboarding(page);
}

test.describe('solo invite row', () => {
	skipUnlessFixtures();

	test.beforeEach(async ({ page }) => {
		await setupMember(page);
	});

	for (const path of ['/expenses', '/shopping', '/chores']) {
		test(`a solo WG shows the invite on the empty ${path} page`, async ({ page }) => {
			await mockEmptyLists(page, SOLO_BASE);
			await open(page, SOLO_WG.shareCode, path);
			await expect(page.getByText(SOLO_TEXT)).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
			).toBeVisible();
		});

		test(`a WG with flatmates shows no invite on the empty ${path} page`, async ({ page }) => {
			await mockEmptyLists(page, DUO_BASE);
			await open(page, FIXTURE_WG.shareCode, path);
			await expect(page.locator('[data-slot="empty"]')).toBeVisible();
			await expect(page.getByText(SOLO_TEXT)).toHaveCount(0);
		});
	}

	test('a solo WG keeps the invite above a filled expense list', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		await open(page, SOLO_WG.shareCode, '/expenses');
		await page.route(`**${SOLO_BASE}/expenses*`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: '5f1d6e2a-0f1e-4a53-9a39-0f8a8d6a1b11',
							wgId: E2E_CREATED_WG.id,
							paidByMemberId: SOLO_WG.memberId,
							description: 'Putzmittel',
							category: 'household',
							amountCents: 1250,
							currency: 'EUR',
							createdAt: new Date().toISOString(),
							splits: [],
						},
					],
					payments: [],
				},
			}),
		);
		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByText('Putzmittel')).toBeVisible();
		await expect(page.getByText(SOLO_TEXT)).toBeVisible();
	});
});

test.describe('Start card', () => {
	skipUnlessFixtures();

	test.beforeEach(async ({ page }) => {
		await setupMember(page);
	});

	test('dismissing while solo snoozes the card for seven days', async ({ page }) => {
		await mockEmptyLists(page, SOLO_BASE);
		await open(page, SOLO_WG.shareCode);
		const card = page.getByRole('heading', { name: 'Eure WG ist bereit' });
		await expect(card).toBeVisible();
		await page.getByRole('button', { name: 'Später erinnern' }).click();
		await expect(card).toHaveCount(0);

		const stored = await page.evaluate((key) => localStorage.getItem(key), SOLO_KEY);
		expect(Number(stored)).toBeGreaterThan(Date.now() - 60_000);

		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toHaveCount(0);

		// After a week it returns, as does the legacy permanent value.
		for (const value of [String(Date.now() - 8 * DAY_MS), '1']) {
			await page.evaluate(({ key, next }) => localStorage.setItem(key, next), {
				key: SOLO_KEY,
				next: value,
			});
			await page.reload();
			await dismissOnboarding(page);
			await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toBeVisible();
		}
	});

	test('with a flatmate the card names them and leads to the first entry', async ({ page }) => {
		await mockEmptyLists(page, DUO_BASE);
		await open(page, FIXTURE_WG.shareCode);
		await expect(
			page.getByText('Mina ist dabei. Startet mit der ersten Ausgabe oder dem Einkauf.'),
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ausgabe hinzufügen' })).toHaveAttribute(
			'href',
			`/wg/${FIXTURE_WG.shareCode}/expenses?new=1`,
		);
		await expect(page.getByRole('link', { name: 'Einkauf öffnen' })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Mitbewohner einladen', exact: true }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Einstiegshinweis dauerhaft ausblenden' }).click();
		await page.reload();
		await dismissOnboarding(page);
		await expect(page.getByRole('heading', { name: 'Eure WG ist bereit' })).toHaveCount(0);
	});
});
