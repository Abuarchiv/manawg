import { type Locator, type Page, expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

async function expectDialogFitsNarrowViewports(page: Page, dialog: Locator): Promise<void> {
	await page.evaluate(() => {
		document.documentElement.style.fontSize = '200%';
	});
	const cancelButton = page.getByRole('button', { name: 'Abbrechen', exact: true });
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 640 });
			const layout = await dialog.evaluate((element) => ({
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
			}));
			expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			const cancelBounds = await cancelButton.boundingBox();
			expect(cancelBounds).not.toBeNull();
			if (cancelBounds) expect(cancelBounds.x + cancelBounds.width).toBeLessThanOrEqual(width);
		}
	}
}

test('keeps finance forms in narrow viewports at 200% text size', async ({ page }) => {
	const { shareCode, id, memberId, memberName } = FIXTURE_WG;
	await setupMember(page);
	await page.setViewportSize({ width: 320, height: 640 });
	await page.route(`**/api/wg/${shareCode}/members`, (route) =>
		route.fulfill({
			json: {
				members: [
					{ id: memberId, name: memberName, color: null, active: true },
					{ id, name: 'Mina', color: null, active: true },
				],
				viewerIsAdmin: false,
			},
		}),
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
	await page.route(`**/api/wg/${shareCode}/chat/unread-count`, (route) =>
		route.fulfill({ json: { count: 0, overflow: false } }),
	);

	await navigateToFeature(page, `/wg/${shareCode}/ausgaben`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Ausgabe erfassen' }).first().click();
	const expenseDialog = page.getByRole('dialog');
	await expect(expenseDialog).toBeVisible();
	await expectDialogFitsNarrowViewports(page, expenseDialog);
	await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
	await expect(expenseDialog).toBeHidden();

	await page.goto(`/wg/${shareCode}/abos`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Neues Abo' }).click();
	const aboDialog = page.getByRole('dialog');
	await expect(aboDialog).toBeVisible();
	await expectDialogFitsNarrowViewports(page, aboDialog);
	await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
	await expect(aboDialog).toBeHidden();
});
