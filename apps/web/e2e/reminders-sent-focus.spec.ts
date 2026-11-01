// Keyboard focus after sending the primary reminder.
// Why: The primary button unmounts once the reminder is sent; focus must stay inside the page.

import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const API = `**/api/wg/${FIXTURE_WG.shareCode}`;

const owedExpense = {
	id: 'expense-focus-rent',
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 2000,
	currency: 'EUR',
	description: 'Rent',
	occurredAt: '2026-09-01T10:00:00.000Z',
	splits: [
		{
			id: 'split-focus-rent',
			expenseId: 'expense-focus-rent',
			debtorMemberId: MINA_ID,
			amountCents: 1000,
			settledAt: null,
		},
	],
};

test.describe('Reminder sent focus', () => {
	skipUnlessFixtures();

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		test(`keyboard focus stays on the page after sending the primary reminder at ${viewport.width}px`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport);
			await setupMember(page);
			await page.route(`${API}/expenses`, (route) =>
				route.request().method() === 'GET'
					? route.fulfill({ json: { expenses: [owedExpense], payments: [] } })
					: route.continue(),
			);
			const sent: unknown[] = [];
			await page.route(`${API}/reminders`, async (route) => {
				if (route.request().method() === 'POST') {
					sent.push({
						id: 'reminder-focus-1',
						debtorMemberId: MINA_ID,
						creditorMemberId: FIXTURE_WG.memberId,
						amountCents: 1000,
						currency: 'EUR',
						channel: 'push',
						sentAt: new Date().toISOString(),
						oldestDebtAgeDays: 3,
					});
					await route.fulfill({ json: { reminder: sent[0] } });
					return;
				}
				await route.fulfill({ json: { reminders: sent } });
			});
			await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`);
			await navigateToFeature(page, `${BASE}/reminders`);
			await dismissOnboarding(page);

			const primary = page.locator('[data-page-primary-action]').getByRole('button');
			await expect(primary).toBeVisible();
			await primary.focus();
			await page.keyboard.press('Enter');

			await expect(primary).toHaveCount(0);
			await expect
				.poll(() =>
					page.evaluate(
						() =>
							document.activeElement !== document.body && !!document.activeElement?.closest('main'),
					),
				)
				.toBe(true);
		});
	}
});
