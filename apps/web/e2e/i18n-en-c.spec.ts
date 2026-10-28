// English debts, settlement and reminders page.
// Why: The balance card, the settle dialogs and /mahnungen must read as English at phone widths.

import { type Page, expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
const BASE = `/wg/${FIXTURE_WG.shareCode}`;
const API = `**/api/wg/${FIXTURE_WG.shareCode}`;

const owedExpense = {
	id: 'expense-en-rent',
	paidByMemberId: FIXTURE_WG.memberId,
	amountCents: 2000,
	currency: 'EUR',
	description: 'Rent',
	occurredAt: '2026-09-01T10:00:00.000Z',
	splits: [
		{
			id: 'split-en-rent',
			expenseId: 'expense-en-rent',
			debtorMemberId: MINA_ID,
			amountCents: 1000,
			settledAt: null,
		},
	],
};

async function mockExpenses(page: Page, payments: unknown[] = []): Promise<void> {
	await page.route(`${API}/expenses`, (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { expenses: [owedExpense], payments } })
			: route.continue(),
	);
}

test.describe('English debts and reminders', () => {
	skipUnlessFixtures();

	for (const width of [320, 390]) {
		for (const colorScheme of ['light', 'dark'] as const) {
			test(`the reminders page reads English at ${width}px ${colorScheme}`, async ({
				context,
				page,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
				await page.setViewportSize({ width, height: 780 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await mockExpenses(page);
				await page.route(`${API}/reminders`, (route) =>
					route.fulfill({
						json: {
							reminders: [
								{
									id: 'reminder-en-1',
									debtorMemberId: MINA_ID,
									creditorMemberId: FIXTURE_WG.memberId,
									amountCents: 1000,
									currency: 'EUR',
									channel: 'push',
									sentAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
									oldestDebtAgeDays: 3,
								},
							],
						},
					}),
				);
				await navigateToFeature(page, `${BASE}/mahnungen`);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page.getByRole('heading', { level: 1, name: 'Reminders' })).toBeAttached();
				await expect(page.getByRole('heading', { name: 'Open amounts' })).toBeVisible();
				await expect(page.getByText('Mina owes you').first()).toBeVisible();
				await expect(page.getByText('€10.00').first()).toBeVisible();
				await expect(page.getByRole('button', { name: 'Remind Mina' })).toBeVisible();
				await expect(
					page.getByRole('heading', { name: 'Recent reminders (30 days)' }),
				).toBeVisible();
				await expect(page.getByText('Push notification')).toBeVisible();
				await expect(page.getByText('3 days ago').first()).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoHorizontalOverflow(page);
			});

			test(`the balance card reads English at ${width}px ${colorScheme}`, async ({
				context,
				page,
				baseURL,
			}) => {
				await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
				await page.setViewportSize({ width, height: 780 });
				await page.emulateMedia({ colorScheme });
				await setupMember(page);
				await mockExpenses(page, [
					{
						id: PAYMENT_ID,
						fromMemberId: MINA_ID,
						toMemberId: FIXTURE_WG.memberId,
						amountCents: 400,
						currency: 'EUR',
						completedAt: '2026-09-02T10:00:00.000Z',
					},
				]);
				await page.route(`${API}/recurring-expenses`, (route) =>
					route.fulfill({ json: { recurringExpenses: [] } }),
				);
				await page.route(`${API}/dashboard`, (route) =>
					route.fulfill({
						json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] },
					}),
				);
				await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`);
				await navigateToFeature(page, `${BASE}/ausgaben`);
				await dismissOnboarding(page);

				await expect(page.getByText('Your balance', { exact: true })).toBeVisible();
				await expect(page.getByText('You are owed').first()).toBeVisible();
				await expect(page.getByRole('list', { name: 'Balance per member' })).toBeVisible();
				await expect(page.getByRole('list', { name: 'Your open payments' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Settle up' })).toBeVisible();
				await expect(page.getByRole('link', { name: 'All reminders' })).toBeVisible();
				await expect(page.getByRole('link', { name: 'Monthly statement' })).toBeVisible();
				const cash = page.getByRole('list', { name: 'Your cash payments' });
				await expect(cash.getByText('Mina to you')).toBeVisible();
				await expect(cash.getByRole('button', { name: 'Reverse' })).toBeVisible();

				await expectNoGermanChrome(page);
				await expectNoHorizontalOverflow(page);
			});
		}
	}

	test('the settle dialog, its error and the reversal dialog read English', async ({
		context,
		page,
		baseURL,
	}) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
		await page.setViewportSize({ width: 390, height: 780 });
		await setupMember(page);
		await mockExpenses(page, [
			{
				id: PAYMENT_ID,
				fromMemberId: MINA_ID,
				toMemberId: FIXTURE_WG.memberId,
				amountCents: 400,
				currency: 'EUR',
				completedAt: '2026-09-02T10:00:00.000Z',
			},
		]);
		await page.route(`${API}/recurring-expenses`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route(`${API}/dashboard`, (route) =>
			route.fulfill({ json: { openShoppingCount: 0, dueChores: [], dueRecurringExpenses: [] } }),
		);
		await mockUnreadCount(page, `/api/wg/${FIXTURE_WG.shareCode}`);
		await page.route(`${API}/expenses/settle-batch*`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						json: {
							currency: 'EUR',
							netCents: 600,
							settleableCents: 600,
							remainingCents: 0,
							splits: [{ id: 'split-en-rent', expenseId: owedExpense.id, amountCents: 600 }],
						},
					})
				: route.fulfill({
						status: 409,
						json: { error: 'settlement_changed', code: 'settlement_changed' },
					}),
		);
		await navigateToFeature(page, `${BASE}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Settle up' }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Confirm a payment already made' });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText(
				'Only confirm if Mina has already paid €6.00 to you. No money is transferred.',
			),
		).toBeVisible();
		await expect(dialog.getByText('These shares were checked just now.')).toBeVisible();
		await expect(dialog.getByRole('list', { name: 'Expense shares covered' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
		await dialog.getByRole('button', { name: 'Record €6.00 as paid' }).click();
		await expect(
			page
				.getByText('The open amounts have changed. Check the payment again before you record it.')
				.first(),
		).toBeVisible();

		await page.getByRole('button', { name: 'Reverse' }).click();
		const reverse = page.getByRole('dialog', { name: 'Reverse cash payment?' });
		await expect(reverse).toBeVisible();
		await expect(reverse).toContainText('The cash payment of €4.00 from Mina to');
		await expect(reverse).toContainText('the amount is open again');
		await expect(reverse.getByRole('button', { name: 'Reverse' })).toBeVisible();
	});

	test('sending a reminder confirms in English', async ({ context, page, baseURL }) => {
		await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
		await page.setViewportSize({ width: 390, height: 780 });
		await setupMember(page);
		await mockExpenses(page);
		await page.route(`${API}/reminders`, (route) =>
			route.request().method() === 'POST'
				? route.fulfill({ status: 201, json: { reminder: { id: 'reminder-new' }, warning: null } })
				: route.fulfill({ json: { reminders: [] } }),
		);
		await navigateToFeature(page, `${BASE}/mahnungen`);
		await dismissOnboarding(page);

		await expect(page.getByText('Reminders you send appear here.')).toBeVisible();
		await page.getByRole('button', { name: 'Remind Mina' }).click();
		await expect(page.getByText('Reminder sent to Mina.')).toBeVisible();
	});

	for (const rejection of [
		{ status: 429, error: 'reminder_cooldown', label: /^Available again (later|in \d+ days?)$/ },
		{ status: 403, error: 'debtor_opted_out', label: 'Prefers no reminders' },
	]) {
		test(`a rejected reminder (${rejection.error}) reads English`, async ({
			context,
			page,
			baseURL,
		}) => {
			await setEnglishLocale(context, baseURL ?? 'http://localhost:3112');
			await page.setViewportSize({ width: 390, height: 780 });
			await setupMember(page);
			await mockExpenses(page);
			// After the rejected POST the page reloads the history: a cooldown shows up there as the recent reminder.
			let posted = false;
			await page.route(`${API}/reminders`, (route) => {
				if (route.request().method() === 'POST') {
					posted = true;
					return route.fulfill({
						status: rejection.status,
						json: { error: rejection.error, code: rejection.error },
					});
				}
				const reminders =
					posted && rejection.error === 'reminder_cooldown'
						? [
								{
									id: 'reminder-en-recent',
									debtorMemberId: MINA_ID,
									creditorMemberId: FIXTURE_WG.memberId,
									amountCents: 1000,
									currency: 'EUR',
									channel: 'push',
									sentAt: new Date().toISOString(),
									oldestDebtAgeDays: 3,
								},
							]
						: [];
				return route.fulfill({ json: { reminders } });
			});
			await navigateToFeature(page, `${BASE}/mahnungen`);
			await dismissOnboarding(page);

			await page.getByRole('button', { name: 'Remind Mina' }).click();
			await expect(page.getByRole('button', { name: rejection.label })).toBeVisible();
			await expectNoGermanChrome(page);
		});
	}
});
