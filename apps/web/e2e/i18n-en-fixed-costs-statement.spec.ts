// English fixed costs and monthly statement.
// Why: Both routes must read as English chrome at phone widths and parse English amounts.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';
import { expectNoGermanChrome, setEnglishLocale } from './support/i18n';

const OTHER_MEMBER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const BASE = `/wg/${FIXTURE_WG.shareCode}`;

const abo = {
	id: 'recurring-en-1',
	description: 'Music plan',
	category: 'freizeit',
	amountCents: 1299,
	currency: 'EUR',
	paidByMemberId: FIXTURE_WG.memberId,
	intervalMonths: 1,
	nextDueAt: '2099-12-01T12:00:00.000Z',
	lastCreatedAt: null,
	pausedAt: null,
	splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1299 }],
};

const septemberExpense = {
	id: 'expense-en-1',
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 3000,
	currency: 'EUR',
	description: 'Groceries',
	category: 'lebensmittel',
	occurredAt: '2026-09-03T10:00:00.000Z',
	splits: [
		{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1500, settledAt: null },
		{ debtorMemberId: OTHER_MEMBER_ID, amountCents: 1500, settledAt: null },
	],
};

/** The WG header and the back link belong to the shell package; only this package's chrome is scanned. */
async function expectNoGermanPageChrome(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const element of document.querySelectorAll('header, nav, a[aria-label^="Zurück"]')) {
			element.remove();
		}
	});
	await expectNoGermanChrome(page);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test.describe('English fixed costs and statement', () => {
	skipUnlessFixtures();

	for (const width of [320, 390]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`fixed costs read English at ${width}px ${colorScheme}`, async ({
				context,
				page,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
				await page.setViewportSize({ width, height: 780 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses*`, (route) =>
					route.fulfill({
						json: {
							recurringExpenses: [abo, { ...abo, id: 'recurring-en-2', pausedAt: '2026-10-01' }],
						},
					}),
				);
				await navigateToFeature(page, `${BASE}/recurring`);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { level: 1, name: 'Fixed costs' })).toBeAttached();
				await expect(page.getByText('Per month')).toBeVisible();
				await expect(page.getByText('Your share')).toBeVisible();
				await expect(page.getByText('€12.99').first()).toBeVisible();
				await expect(page.getByText('12,99')).toHaveCount(0);
				await expect(page.getByRole('group', { name: 'Filter fixed costs' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Paused' })).toBeVisible();
				await expect(page.getByText(/next on \d{1,2} \p{L}{3,4}/u).first()).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add fixed cost' })).toBeVisible();

				await page
					.getByRole('button', { name: /Open details:/ })
					.first()
					.click();
				await expect(page.getByText(/Next 3 entries: /)).toBeVisible();
				await expect(page.getByRole('button', { name: 'Pause: Music plan' })).toBeVisible();

				await expectNoGermanPageChrome(page);
				await expectNoSidewaysScroll(page);
			});

			test(`statement reads English at ${width}px ${colorScheme}`, async ({
				context,
				page,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
				await page.setViewportSize({ width, height: 780 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses*`, (route) =>
					route.fulfill({ json: { expenses: [septemberExpense], payments: [] } }),
				);
				await navigateToFeature(page, `${BASE}/statement?monat=2026-09`);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { level: 1, name: 'September 2026' })).toBeVisible();
				await expect(page.getByText(/^Monthly statement · /)).toBeVisible();
				await expect(page.getByText('1 Sept – 30 Sept 2026')).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Balances' })).toBeVisible();
				await expect(page.getByText('Split between 2 people')).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Settlement' })).toBeVisible();
				await expect(
					page.getByText('The simplest way: one transfer, then everyone is settled up.'),
				).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
				await expect(page.getByText('Groceries').first()).toBeVisible();
				await expect(page.getByText('€30.00').first()).toBeVisible();
				await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();

				await expectNoGermanPageChrome(page);
				await expectNoSidewaysScroll(page);
			});
		}
	}

	test('an English amount with a thousands separator saves in cents', async ({
		context,
		page,
		baseURL,
	}) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
		await page.setViewportSize({ width: 390, height: 780 });
		await setupMember(page);
		let created: { amountCents?: number; description?: string } | null = null;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses*`, async (route) => {
			if (route.request().method() === 'POST') {
				created = route.request().postDataJSON();
				return route.fulfill({
					status: 201,
					json: { recurringExpense: { ...abo, id: 'recurring-created', ...created } },
				});
			}
			return route.fulfill({ json: { recurringExpenses: [] } });
		});
		await navigateToFeature(page, `${BASE}/recurring`);

		await expect(page.getByText('No fixed costs yet')).toBeVisible();
		await page.getByRole('button', { name: 'Add fixed cost' }).click();
		const dialog = page.getByRole('dialog', { name: 'New fixed cost' });
		await expect(dialog.getByLabel('Description')).toBeVisible();
		await expect(dialog.getByLabel('Paid by')).toBeVisible();
		await expect(dialog.getByLabel('First due date')).toBeVisible();
		await dialog.getByLabel('Description').fill('Rent');
		await dialog.getByLabel('Amount').fill('1,234.50');
		await dialog.getByRole('button', { name: 'Add fixed cost' }).click();

		await expect(page.getByText('Fixed cost added.')).toBeVisible();
		expect(created).toMatchObject({ description: 'Rent', amountCents: 123450 });
	});
	test('dialogs, split hint and conflict error read English', async ({
		context,
		page,
		baseURL,
	}) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
		await page.setViewportSize({ width: 390, height: 780 });
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/recurring-expenses**`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({ json: { recurringExpenses: [abo] } })
				: route.fulfill({
						status: 409,
						json: { error: 'recurring_expense_changed', code: 'recurring_expense_changed' },
					}),
		);
		await navigateToFeature(page, `${BASE}/recurring`);

		await page.getByRole('button', { name: /Open details:/ }).click();
		await page.getByRole('button', { name: 'Delete Music plan' }).click();
		const deleteDialog = page.getByRole('alertdialog');
		await expect(deleteDialog.getByText('Delete fixed cost?')).toBeVisible();
		await expect(deleteDialog.getByText(/Expenses already recorded stay\./)).toBeVisible();
		await deleteDialog.getByRole('button', { name: 'Cancel' }).click();

		await page.getByRole('button', { name: 'Pause: Music plan' }).click();
		await expect(
			page
				.getByText(
					/The change to this fixed cost could not be saved: This fixed cost has just been added as an expense or changed/,
				)
				.first(),
		).toBeVisible();

		await page.getByRole('button', { name: 'Add fixed cost' }).click();
		const dialog = page.getByRole('dialog', { name: 'New fixed cost' });
		await dialog.getByLabel('Amount').fill('30');
		await dialog.getByText('Manually', { exact: true }).click();
		await expect(dialog.getByText(/Allocated €0\.00 of €30\.00/)).toBeVisible();
		await dialog.getByLabel('Description').fill('Rent');
		await dialog.getByRole('button', { name: 'Close fixed costs editor' }).click();
		await expect(page.getByRole('alertdialog').getByText('Discard changes?')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
	});
});
