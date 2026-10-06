// Settlement, debts and balances: scope, netting, per-currency separation, reminders, balance consistency.
// Why: dashboard, debt list and settlement must agree to the cent and never mix currencies.

import { expect, test } from '@playwright/test';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	tuple,
} from './_helpers';

test.describe('settlement scope', () => {
	const memberA = '11111111-1111-4111-8111-111111111111';
	const memberB = '22222222-2222-4222-8222-222222222222';
	const noHttpBaseUrl = 'https://example.invalid';
	const fixtureMemberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	test.describe('Settlement HTTP cache policy', () => {
		test.skip(
			process.env.BASE_URL === noHttpBaseUrl,
			'HTTP checks are intentionally skipped for the no-network pure-test run',
		);

		test('sets no-store on an invalid share-code preamble response', async ({ request }) => {
			const response = await request.get(
				`/api/wg/not-a-code/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
			);

			expect(response.status()).toBe(400);
			expect(response.headers()['cache-control']).toBe('private, no-store');
			await expect(response.json()).resolves.toMatchObject({ error: 'invalid_share_code' });
		});

		test('sets no-store on a withWgRoute authentication rejection', async ({ request }) => {
			test.skip(
				process.env.CI !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
				'the fixture authentication case requires the local DB-down fixture server',
			);

			const response = await request.get(
				`/api/wg/MTE8PZAT/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
				{ headers: { 'x-manawg-expected-member-id': fixtureMemberId } },
			);

			expect(response.status()).toBe(401);
			expect(response.headers()['cache-control']).toBe('private, no-store');
			await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
		});
	});
});

test.describe('debt summary reminder link', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('keeps finance actions and expense summary keyboard-operable at phone sizes', async ({
		page,
		browserName,
	}, testInfo) => {
		const { shareCode, memberId } = FIXTURE_WG;
		const otherMemberId = '11111111-1111-4111-8111-111111111111';
		const longMemberName = 'A'.repeat(80);
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members`, (route) =>
			route.fulfill({
				json: {
					members: [
						{ id: memberId, name: 'Abu', color: null, active: true },
						{ id: otherMemberId, name: longMemberName, color: null, active: true },
					],
					viewerIsAdmin: false,
				},
			}),
		);
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
									debtorMemberId: otherMemberId,
									amountCents: 1000,
									settledAt: null,
								},
							],
						},
						{
							id: 'expense-chf',
							paidByMemberId: memberId,
							amountCents: 24690,
							currency: 'CHF',
							description: 'Stromnachzahlung Oktober',
							occurredAt: '2026-09-02T10:00:00.000Z',
							splits: [
								{
									id: 'split-chf',
									expenseId: 'expense-chf',
									debtorMemberId: otherMemberId,
									amountCents: 12345,
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
		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		const debtList = page.getByRole('list', { name: 'Deine offenen Zahlungen' });
		await expect(debtList).toBeVisible();
		// Balances are always visible rather than hidden behind „Alle Salden“.
		const balanceList = page.getByRole('list', { name: 'Saldo pro Mitglied' });
		await expect(balanceList).toBeVisible();
		const balanceLabel = page.getByText('Dein Saldo', { exact: true });
		await expect(balanceLabel).toBeVisible();
		// The balance is the heading; the open payments follow directly below it.
		const balancePrecedesDebtsInDom = await balanceLabel.evaluate((node) => {
			const debt = document.querySelector('[aria-label="Deine offenen Zahlungen"]');
			return debt
				? Boolean(node.compareDocumentPosition(debt) & Node.DOCUMENT_POSITION_FOLLOWING)
				: false;
		});
		expect(balancePrecedesDebtsInDom).toBe(true);
		const debts = debtList.locator('[data-slot="item"]');
		await expect(debts).toHaveCount(2);
		const secondaryDebt = debts.nth(1);
		const settleButton = secondaryDebt.getByRole('button', { name: 'Ausgleichen' });
		const remindButton = secondaryDebt.getByRole('button', { name: 'Erinnern', exact: true });
		await expect(settleButton).toBeVisible();
		await expect(remindButton).toBeVisible();
		await settleButton.focus();
		await page.keyboard.press('Tab');
		await expect(remindButton).toBeFocused();
		const reminderLink = page.getByRole('link', { name: 'Alle Erinnerungen' });
		await expect(reminderLink).toBeVisible();
		await expect(reminderLink).toHaveAttribute('href', `/wg/${shareCode}/mahnungen`);
		await reminderLink.focus();
		await expect(reminderLink).toBeFocused();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		if (browserName === 'webkit') {
			// WebKit's native reverse Tab traversal can skip anchors without Full Keyboard Access.
			await reminderLink.focus();
		}
		await expect(reminderLink).toBeFocused();
		await expect
			.poll(() => reminderLink.evaluate((node) => node.matches(':focus-visible')))
			.toBe(true);
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const textScale of ['100%', '200%'] as const) {
				await page.evaluate((fontSize) => {
					document.documentElement.style.setProperty('font-size', fontSize, 'important');
				}, textScale);
				for (const width of [320, 360, 390]) {
					await page.setViewportSize({ width, height: 844 });
					// Measure both buttons in the same frame: getBoundingClientRect is
					// viewport-relative, and two separate evaluate calls can straddle
					// scroll or render steps and report a false overlap.
					const metrics = await secondaryDebt.evaluate((row) =>
						(['Ausgleichen', 'Erinnern'] as const).map((label) => {
							const element = [...row.querySelectorAll('button')].find(
								(button) => button.textContent?.trim() === label,
							);
							if (!element) throw new Error(`${label} button missing`);
							const buttonRect = element.getBoundingClientRect();
							const textRange = document.createRange();
							textRange.selectNodeContents(element);
							const textRect = textRange.getBoundingClientRect();
							const hitTarget = getComputedStyle(element, '::after');
							return {
								button: {
									left: buttonRect.left,
									right: buttonRect.right,
									top: buttonRect.top,
									bottom: buttonRect.bottom,
								},
								textFits:
									textRect.left >= buttonRect.left - 1 && textRect.right <= buttonRect.right + 1,
								touchWidth: Number.parseFloat(hitTarget.minWidth),
								touchHeight: Number.parseFloat(hitTarget.height),
							};
						}),
					);
					const [settle, remind] = tuple(metrics, 2);
					const buttonsOverlap =
						settle.button.left < remind.button.right &&
						remind.button.left < settle.button.right &&
						settle.button.top < remind.button.bottom &&
						remind.button.top < settle.button.bottom;
					const layout = await page.evaluate(() => ({
						viewport: document.documentElement.clientWidth,
						scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
					}));

					expect(
						buttonsOverlap,
						`${width}px / ${textScale} / ${theme}: action buttons overlap`,
					).toBe(false);
					expect(
						settle.textFits,
						`${width}px / ${textScale} / ${theme}: settlement text clips`,
					).toBe(true);
					expect(remind.textFits, `${width}px / ${textScale} / ${theme}: reminder text clips`).toBe(
						true,
					);
					expect(
						layout.scroll,
						`${width}px / ${textScale} / ${theme}: page overflows horizontally`,
					).toBeLessThanOrEqual(layout.viewport);
					expect(settle.touchWidth).toBeGreaterThanOrEqual(44);
					expect(settle.touchHeight).toBeGreaterThanOrEqual(44);
					if (textScale === '200%') {
						const balanceBox = await balanceLabel.boundingBox();
						const debtBox = await debtList.boundingBox();
						if (!balanceBox || !debtBox) throw new Error('Summary must have layout boxes');
						expect(balanceBox.y).toBeLessThan(debtBox.y);
						const chfBalance = balanceList
							.getByRole('listitem')
							.filter({ hasText: longMemberName })
							.filter({ hasText: 'CHF' });
						await expect(chfBalance).toHaveCount(1);
						const balanceMetrics = await chfBalance.evaluate((row) => {
							const name = row.firstElementChild?.lastElementChild as HTMLElement | null;
							const amount = row.lastElementChild as HTMLElement | null;
							const card = row.closest('[data-slot="card"]') as HTMLElement | null;
							if (!name || !amount || !card) throw new Error('Balance row layout is incomplete');
							const nameRect = name.getBoundingClientRect();
							const amountRect = amount.getBoundingClientRect();
							const cardRect = card.getBoundingClientRect();
							return {
								nameWidth: nameRect.width,
								nameClientWidth: name.clientWidth,
								nameScrollWidth: name.scrollWidth,
								nameRight: nameRect.right,
								cardRight: cardRect.right,
								amountLeft: amountRect.left,
								amountRight: amountRect.right,
								cardLeft: cardRect.left,
							};
						});
						expect(
							balanceMetrics.nameWidth,
							`${width}px / ${theme}: member name must have visible width`,
						).toBeGreaterThan(32);
						expect(
							balanceMetrics.nameScrollWidth,
							`${width}px / ${theme}: member name must not be clipped`,
						).toBeLessThanOrEqual(balanceMetrics.nameClientWidth + 1);
						expect(
							balanceMetrics.nameRight,
							`${width}px / ${theme}: member name extends beyond its card`,
						).toBeLessThanOrEqual(balanceMetrics.cardRight + 1);
						expect(
							balanceMetrics.amountLeft,
							`${width}px / ${theme}: balance amount starts outside its card`,
						).toBeGreaterThanOrEqual(balanceMetrics.cardLeft - 1);
						expect(
							balanceMetrics.amountRight,
							`${width}px / ${theme}: balance amount extends beyond its card`,
						).toBeLessThanOrEqual(balanceMetrics.cardRight + 1);
						await page.screenshot({
							path: testInfo.outputPath(`reminders-${width}-${theme}.png`),
							animations: 'disabled',
						});
					}
				}
			}
		}
		await reminderLink.focus();
		await expect(reminderLink).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/mahnungen$`));
	});
});

test.describe('debt settle error notice', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
	test.use({ hasTouch: true, isMobile: true });

	const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

	test('cancelling the settle-confirmation dialog clears a failed settle attempt error', async ({
		page,
	}) => {
		const { shareCode, memberId } = FIXTURE_WG;

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
		await page.route(`**/api/wg/${shareCode}/expenses/settle-batch*`, (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({
					json: {
						currency: 'EUR',
						netCents: 1000,
						settleableCents: 1000,
						remainingCents: 0,
						splits: [{ id: 'split-rent', expenseId: 'expense-rent', amountCents: 1000 }],
					},
				});
			}
			return route.fulfill({ status: 500, json: { error: 'server_error' } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Ausgleichen' }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Bereits erfolgte Zahlung bestätigen' });
		await expect(dialog).toBeVisible();

		await dialog.getByRole('button', { name: /als bezahlt eintragen/i }).click();
		await expect(
			dialog.getByText('Ausgleich konnte nicht gespeichert werden', { exact: false }),
		).toBeVisible();

		await dialog.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(dialog).not.toBeVisible();
		await expect(
			page.getByText('Ausgleich konnte nicht gespeichert werden', { exact: false }),
		).toHaveCount(0);
	});
});
