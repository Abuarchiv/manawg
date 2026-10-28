// Voiding a recorded cash payment from the Ausgaben card.
// Why: the only way to correct a wrong cash entry; the void must be confirmed and idempotent.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
} from './support/helpers';

const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';

test('a cash payment is voided after confirmation and the list reloads without it', async ({
	page,
}) => {
	const { shareCode, memberId } = FIXTURE_WG;
	let voided = false;
	const voidRequests: Array<{ key: string | null }> = [];

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
				payments: voided
					? []
					: [
							{
								id: PAYMENT_ID,
								fromMemberId: MINA_ID,
								toMemberId: memberId,
								amountCents: 400,
								currency: 'EUR',
								completedAt: '2026-09-02T10:00:00.000Z',
							},
						],
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
	await page.route(`**/api/wg/${shareCode}/payments/manual/${PAYMENT_ID}`, (route) => {
		voidRequests.push({ key: route.request().headers()['idempotency-key'] ?? null });
		voided = true;
		return route.fulfill({
			json: { paymentId: PAYMENT_ID, voided: true, amountCents: 400, currency: 'EUR' },
		});
	});

	await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
	await dismissOnboarding(page);

	const list = page.getByRole('list', { name: 'Deine Barzahlungen' });
	await expect(list).toBeVisible();
	await list.getByRole('button', { name: /Stornieren/ }).click();

	const dialog = page.getByRole('dialog', { name: 'Barzahlung stornieren?' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('wieder offen');
	await dialog.getByRole('button', { name: 'Stornieren' }).click();

	await expect(list).toHaveCount(0);
	expect(voidRequests).toHaveLength(1);
	expect(voidRequests[0]?.key).toBeTruthy();
});
