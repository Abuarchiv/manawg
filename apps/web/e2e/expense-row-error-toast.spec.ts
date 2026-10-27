// A failed row action on the Ausgaben page.
// Why: the error banner sits above the list, so a failure further down must also raise a toast.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

test.describe('expense row error toast', () => {
	skipUnlessFixtures();

	test('a failed delete shows its error as a toast and keeps the row', async ({ page }) => {
		const { shareCode, memberId } = FIXTURE_WG;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-pizza',
							paidByMemberId: memberId,
							amountCents: 2400,
							currency: 'EUR',
							description: 'Pizza',
							occurredAt: '2026-09-01T10:00:00.000Z',
							splits: [
								{
									id: 'split-pizza',
									expenseId: 'expense-pizza',
									debtorMemberId: MINA_ID,
									amountCents: 1200,
									settledAt: null,
								},
							],
						},
					],
					payments: [],
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/expenses/expense-pizza`, (route) =>
			route.request().method() === 'DELETE'
				? route.fulfill({ status: 500, json: { error: 'internal_error' } })
				: route.continue(),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Aktionen für Pizza' }).click();
		await page.getByRole('menuitem', { name: 'Löschen' }).click();
		await page.getByRole('button', { name: 'Löschen' }).last().click();

		await expect(
			page.getByRole('region', { name: 'Benachrichtigungen' }).getByRole('alert'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Aktionen für Pizza' })).toBeVisible();
	});
});
