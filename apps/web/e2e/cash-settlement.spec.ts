// A netted debt without a matching share can be entered as a cash payment.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('cash settlement', () => {
	skipUnlessFixtures();

	const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

	test('offers the whole net debt as a cash payment when no share fits', async ({ page }) => {
		const { shareCode, memberId } = FIXTURE_WG;
		let cashBody: Record<string, unknown> | null = null;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/expenses`, (route) =>
			route.fulfill({
				json: {
					expenses: [
						{
							id: 'expense-rent',
							paidByMemberId: memberId,
							amountCents: 2000,
							currency: 'EUR',
							description: 'Miete',
							occurredAt: '2026-09-01T10:00:00.000Z',
							splits: [
								{
									id: 'split-rent',
									expenseId: 'expense-rent',
									debtorMemberId: MINA_ID,
									amountCents: 1000,
									settledAt: null,
								},
							],
						},
					],
					payments: [],
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`**/api/wg/${shareCode}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${shareCode}`);
		await page.route(`**/api/wg/${shareCode}/expenses/settle-batch*`, (route) =>
			route.fulfill({
				json: {
					currency: 'EUR',
					netCents: 1000,
					settleableCents: 0,
					remainingCents: 1000,
					splits: [],
					reason: 'no_direct_splits',
				},
			}),
		);
		await page.route(`**/api/wg/${shareCode}/payments/manual`, (route) => {
			cashBody = route.request().postDataJSON();
			return route.fulfill({ json: { amountCents: 1000, currency: 'EUR' } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/expenses`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Ausgleichen' }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Bereits erfolgte Zahlung bestätigen' });
		await expect(dialog.getByText('lässt sich keinem einzelnen Anteil zuordnen')).toBeVisible();
		await expect(dialog.getByRole('button', { name: /als bezahlt eintragen/i })).toHaveCount(0);

		await dialog.getByRole('button', { name: /Gesamten Saldo .* bar eintragen/ }).click();

		await expect
			.poll(() => cashBody)
			.toEqual({
				fromMemberId: MINA_ID,
				toMemberId: memberId,
				currency: 'EUR',
				expectedNetCents: 1000,
			});
	});
});
