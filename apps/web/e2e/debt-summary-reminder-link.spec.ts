import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

test('keeps expense summary and debt content in visual and keyboard order with collapsed balances', async ({
	page,
}, testInfo) => {
	const { shareCode, memberId } = FIXTURE_WG;
	const otherMemberId = '11111111-1111-4111-8111-111111111111';
	await setupMember(page);
	await page.route(`**/api/wg/${shareCode}/members`, (route) =>
		route.fulfill({
			json: {
				members: [
					{ id: memberId, name: 'Abu', color: null, active: true },
					{ id: otherMemberId, name: 'Mina', color: null, active: true },
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
	await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
		route.fulfill({ json: { count: 0, overflow: false } }),
	);
	await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
	await dismissOnboarding(page);

	await expect(page.getByRole('heading', { name: 'Deine offenen Zahlungen' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Alle Salden' })).toBeVisible();
	const balanceLabel = page.getByText('Dein Saldo', { exact: true });
	const debtHeading = page.getByRole('heading', { name: 'Deine offenen Zahlungen' });
	await expect(balanceLabel).toBeVisible();
	const debtPrecedesBalanceInDom = await balanceLabel.evaluate((node) => {
		const debt = Array.from(document.querySelectorAll('h2')).find(
			(heading) => heading.textContent?.trim() === 'Deine offenen Zahlungen',
		);
		return debt
			? Boolean(debt.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
			: false;
	});
	expect(debtPrecedesBalanceInDom).toBe(true);
	const balanceTrigger = page.getByRole('button', { name: 'Saldo pro Mitglied', exact: true });
	const reminderLink = page.getByRole('link', { name: 'Alle Erinnerungen' });
	await expect(reminderLink).toBeVisible();
	await expect(reminderLink).toHaveAttribute('href', `/wg/${shareCode}/mahnungen`);
	await reminderLink.focus();
	await expect(reminderLink).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(balanceTrigger).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(reminderLink).toBeFocused();
	await expect
		.poll(() => reminderLink.evaluate((node) => node.matches(':focus-visible')))
		.toBe(true);
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '200%';
	});
	for (const theme of ['light', 'dark'] as const) {
		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 844 });
			await page.emulateMedia({ colorScheme: theme });
			const layout = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				page: document.documentElement.scrollWidth,
			}));
			expect(layout.page).toBeLessThanOrEqual(layout.viewport);
			const balanceBox = await balanceLabel.boundingBox();
			const debtBox = await debtHeading.boundingBox();
			if (!balanceBox || !debtBox) throw new Error('Summary headings must have layout boxes');
			expect(debtBox.y).toBeLessThan(balanceBox.y);
			await page.screenshot({
				path: testInfo.outputPath(`reminders-${width}-${theme}.png`),
				animations: 'disabled',
			});
		}
	}
	await reminderLink.focus();
	await expect(reminderLink).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/wg/${shareCode}/mahnungen$`));
});
