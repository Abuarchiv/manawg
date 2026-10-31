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

	for (const offline of [false, true]) {
		test(`keeps participant checkboxes usable ${offline ? 'offline before first opening' : 'after an amount is entered'}`, async ({
			page,
			context,
		}) => {
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
			if (offline) {
				await page.waitForLoadState('networkidle');
				await context.setOffline(true);
			}
			await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).first().click();
			const dialog = page.getByRole('dialog');
			await dialog.getByLabel('Betrag', { exact: true }).fill('12,50');
			await expect(dialog.getByRole('list').first()).toBeVisible();

			for (const name of ['Alexandra', 'Maximilian']) {
				const checkbox = dialog.getByRole('checkbox', { name });
				await expect(checkbox).toBeVisible();
				await expect(checkbox).toBeChecked();
				await expect(checkbox.locator('svg path')).toHaveCSS('opacity', '1');
			}
			const participant = dialog.getByRole('checkbox', { name: 'Maximilian' });
			await participant.click();
			await expect(participant).not.toBeChecked();
			await expect(participant.locator('svg path')).toHaveCSS('opacity', '0');
			await participant.click();
			await expect(participant).toBeChecked();
			await expect(participant.locator('svg path')).toHaveCSS('opacity', '1');
		});
	}
});
