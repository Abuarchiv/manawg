// Statement balances table at the narrowest phone width.
// Why: The Saldo column must stay inside the table and both tables must be reachable by keyboard.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';
import { setEnglishLocale } from './support/i18n';

const OTHER_MEMBER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const LONG_NAME = 'Spuelmaschinenbeauftragte Alexandra';

const septemberExpense = {
	id: 'expense-fit-1',
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 3000,
	currency: 'EUR',
	description: 'Groceries',
	category: 'groceries',
	occurredAt: '2026-09-14T10:00:00.000Z',
	splits: [
		{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1500, settledAt: null },
		{ debtorMemberId: OTHER_MEMBER_ID, amountCents: 1500, settledAt: null },
	],
};

async function openStatement(page: Page, otherName?: string): Promise<void> {
	await page.setViewportSize({ width: 320, height: 700 });
	await setupMember(page);
	if (otherName) {
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, color: null, active: true },
						{ id: OTHER_MEMBER_ID, name: otherName, color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
	}
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses*`, (route) =>
		route.fulfill({ json: { expenses: [septemberExpense], payments: [] } }),
	);
	await navigateToFeature(page, `${BASE}/statement?month=2026-09`);
}

async function expectBalancesFit(page: Page, balanceHeader: string): Promise<void> {
	const header = page.getByRole('columnheader', { name: balanceHeader, exact: true });
	await expect(header).toBeVisible();
	const fit = await header.evaluate((th) => {
		const wrapper = th.closest('div');
		return {
			scroll: wrapper?.scrollWidth ?? 0,
			client: wrapper?.clientWidth ?? 0,
			right: th.getBoundingClientRect().right,
		};
	});
	expect(fit.scroll, 'the balances table does not scroll sideways').toBeLessThanOrEqual(fit.client);
	expect(fit.right, 'the balance column ends inside the viewport').toBeLessThanOrEqual(320);
}

async function expectScrollRegionsFocusable(page: Page): Promise<void> {
	for (const heading of ['statement-balances', 'statement-items']) {
		const region = page.locator(`section[aria-labelledby="${heading}"] [role="region"]`);
		await expect(region).toHaveAttribute('tabindex', '0');
		await expect(region).toHaveAttribute('aria-labelledby', heading);
	}
}

test.describe('Statement balances at 320px', () => {
	skipUnlessFixtures();

	for (const lang of ['de', 'en'] as const) {
		const balance = lang === 'en' ? 'Balance' : 'Saldo';

		test(`balances fit without sideways scroll in ${lang}`, async ({ context, page, baseURL }) => {
			if (lang === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
			await openStatement(page);
			await expectBalancesFit(page, balance);
			await expectScrollRegionsFocusable(page);
		});

		test(`balances fit with a long member name in ${lang}`, async ({ context, page, baseURL }) => {
			if (lang === 'en') await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
			await openStatement(page, LONG_NAME);
			await expect(page.getByRole('rowheader', { name: new RegExp(LONG_NAME) })).toBeVisible();
			await expectBalancesFit(page, balance);
			await expectScrollRegionsFocusable(page);
		});
	}
});
