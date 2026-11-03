// Monthly statement total row in print.
// Why: A table footer group repeats on every printed page, so the month total must print as an ordinary last row.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const EXPENSE_COUNT = 45;

const septemberExpenses = Array.from({ length: EXPENSE_COUNT }, (_, index) => ({
	id: `expense-print-${index}`,
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 1000,
	currency: 'EUR',
	description: `Groceries ${index + 1}`,
	category: 'groceries',
	occurredAt: '2026-09-14T10:00:00.000Z',
	splits: [{ debtorMemberId: FIXTURE_WG.memberId, amountCents: 1000, settledAt: null }],
}));

test.describe('Statement total in print', () => {
	skipUnlessFixtures();

	test('the month total is an ordinary last row group, not a repeating footer', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/expenses*`, (route) =>
			route.fulfill({ json: { expenses: septemberExpenses, payments: [] } }),
		);
		await navigateToFeature(page, `${BASE}/statement?month=2026-09`);
		await expect(page.locator('tfoot')).toHaveCount(1);

		const screenDisplay = await page
			.locator('tfoot')
			.evaluate((el) => getComputedStyle(el).display);
		expect(screenDisplay, 'on screen the total stays a footer group').toBe('table-footer-group');

		await page.emulateMedia({ media: 'print' });
		const printDisplay = await page.locator('tfoot').evaluate((el) => getComputedStyle(el).display);
		expect(printDisplay, 'in print the total does not repeat on every page').toBe(
			'table-row-group',
		);
	});
});
