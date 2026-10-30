// Expense form: equal-split participant checkboxes stay laid out beside the share review.
// Why: A collapsed picker leaves nobody deselectable once an amount is entered.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('equal split participants', () => {
	skipUnlessFixtures();

	test('keeps the participant checkboxes visible after an amount is entered', async ({ page }) => {
		const { shareCode } = FIXTURE_WG;
		const members = [
			{ id: FIXTURE_WG.memberId, name: 'Alexandra', color: null, active: true },
			{ id: FIXTURE_WG.id, name: 'Maximilian', color: null, active: true },
		];
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({ json: { members, viewerIsAdmin: false } }),
		);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({ json: { expenses: [], payments: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/expenses`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Betrag', { exact: true }).fill('12,50');
		await expect(dialog.getByRole('list').first()).toBeVisible();

		for (const name of ['Alexandra', 'Maximilian']) {
			await expect(dialog.getByRole('checkbox', { name })).toBeVisible();
		}
	});
});
