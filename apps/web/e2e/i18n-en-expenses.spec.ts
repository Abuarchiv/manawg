// English expenses: list, row details, form and amount entry.
// Why: The expenses screens ship in English and English amounts must save the right cents.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import {
	expectNoGermanChrome as expectNoGermanChromeOnPage,
	expectNoHorizontalOverflow,
	setEnglishLocale,
} from './support/i18n';

const { shareCode, memberId, memberName } = FIXTURE_WG;
const OTHER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const EXPENSE_ID = '9af0f27a-3d2b-4983-b5cb-3920f6d6e51f';

const MEMBERS = [
	{ id: memberId, name: memberName, color: null, active: true },
	{ id: OTHER_ID, name: 'Lena', color: null, active: true },
];

const EXPENSE = {
	id: EXPENSE_ID,
	paidByMemberId: memberId,
	amountCents: 4800,
	currency: 'EUR',
	description: 'Weekly shop',
	category: 'lebensmittel',
	imageUrl: null,
	occurredAt: '2026-09-24T17:00:00.000Z',
	createdAt: '2026-09-24T17:00:00.000Z',
	updatedAt: '2026-09-24T17:00:00.000Z',
	splits: [
		{ id: 'split-own', debtorMemberId: memberId, amountCents: 2400, settledAt: null },
		{ id: 'split-lena', debtorMemberId: OTHER_ID, amountCents: 2400, settledAt: null },
	],
};

/** The shell header belongs to the shell package; the expenses screens are checked on their own. */
async function expectNoGermanChrome(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const header of document.querySelectorAll('header')) {
			if (!header.closest('[data-finance-content], [role=dialog]')) header.remove();
		}
	});
	await expectNoGermanChromeOnPage(page);
}

async function mockFinanceReads(page: Page, expenses: unknown[]): Promise<void> {
	await page.route(`**/api/wg/${shareCode}/members`, (route) =>
		route.fulfill({ json: { members: MEMBERS, viewerIsAdmin: false } }),
	);
	await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
		route.fulfill({ json: { expenses, payments: [] } }),
	);
	await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
		route.fulfill({ json: { recurringExpenses: [] } }),
	);
	await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
		route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
	);
	await mockUnreadCount(page, `/api/wg/${shareCode}`);
}

test.describe('expenses in English', () => {
	skipUnlessFixtures();

	for (const width of [320, 390]) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`list and row details at ${width}px in ${scheme} mode`, async ({
				context,
				page,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
				await page.emulateMedia({ colorScheme: scheme });
				await setupMember(page);
				await mockFinanceReads(page, [EXPENSE]);
				await page.setViewportSize({ width, height: 800 });
				await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { name: 'Expenses', level: 1 })).toBeAttached();
				await expect(page.getByRole('region', { name: 'Recorded expenses' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add expense' })).toBeVisible();

				const row = page.locator(`#expense-${EXPENSE_ID}`);
				await expect(row).toContainText('You paid');
				await expect(row).toContainText('Groceries');
				await expect(row).toContainText('€24.00');
				await row.getByRole('button').first().click();
				await expect(row.getByText('Owed to you')).toHaveCount(1);
				await expect(row.getByRole('button', { name: 'Mark as paid: Lena' })).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoHorizontalOverflow(page);
			});
		}
	}

	test('empty list reads English', async ({ context, page, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		await mockFinanceReads(page, []);
		await page.setViewportSize({ width: 320, height: 800 });
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);
		await expect(page.getByText('No expenses yet')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Import expenses' })).toBeVisible();
		await expectNoGermanChrome(page);
		await expectNoHorizontalOverflow(page);
	});

	test('the form saves English amounts as cents', async ({ context, page, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		await mockFinanceReads(page, []);
		const bodies: Array<{ amountCents: number }> = [];
		await page.route(`**/api/wg/${shareCode}/expenses`, async (route) => {
			if (route.request().method() === 'POST') {
				bodies.push(route.request().postDataJSON() as { amountCents: number });
				await route.fulfill({ status: 500, json: { error: 'test_response' } });
				return;
			}
			await route.fulfill({ json: { expenses: [], payments: [] } });
		});
		await page.setViewportSize({ width: 390, height: 800 });
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Add expense' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('Add expense')).toBeVisible();
		await expect(dialog.getByLabel('Amount')).toHaveAttribute('placeholder', '0.00');
		await expect(dialog.getByText('People involved and split')).toBeVisible();
		await expectNoGermanChrome(page);

		await dialog.getByLabel('Description').fill('Weekly shop');
		for (const [typed, cents] of [
			['12.50', 1250],
			['12,50', 1250],
			['1,234.50', 123450],
		] as const) {
			await dialog.getByLabel('Amount').fill(typed);
			await dialog.getByRole('button', { name: 'Save expense' }).click();
			await expect.poll(() => bodies.at(-1)?.amountCents).toBe(cents);
			await expect(dialog.getByText('The expense could not be saved.')).toBeVisible();
		}
		expect(bodies).toHaveLength(3);
	});

	test('an invalid amount explains the English format', async ({ context, page, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
		await setupMember(page);
		await mockFinanceReads(page, []);
		await page.setViewportSize({ width: 320, height: 800 });
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Add expense' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Description').fill('Weekly shop');
		await dialog.getByLabel('Amount').fill('abc');
		await dialog.getByRole('button', { name: 'Save expense' }).click();
		await expect(dialog.getByText('Enter an amount above €0, e.g. 12.50.')).toBeVisible();
		await expectNoGermanChrome(page);
	});
});
