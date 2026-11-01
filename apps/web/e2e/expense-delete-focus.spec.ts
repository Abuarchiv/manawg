// Keyboard focus after deleting an expense from the ledger.
// Why: The row unmounts with its dialog, so focus must be handed to the list region.

import { expect, type Page, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

const SHARE_CODE = FIXTURE_WG.shareCode;
const ACTIONS = 'Aktionen für Geschenk für Mina';

async function openDeleteDialog(page: Page): Promise<void> {
	await setupMember(page);
	await navigateToFeature(page, `/wg/${SHARE_CODE}/expenses`);
	const trigger = page.getByRole('button', { name: ACTIONS, exact: true });
	await expect(trigger).toBeVisible();
	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.getByRole('menuitem', { name: 'Löschen' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('alertdialog')).toBeVisible();
}

test.describe('expense delete focus', () => {
	skipUnlessFixtures();

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 1280, height: 800 },
	]) {
		test(`focus stays inside the page after confirming at ${viewport.width}px`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport);
			await page.route(`**/api/wg/${SHARE_CODE}/expenses/*`, (route) =>
				route.request().method() === 'DELETE'
					? route.fulfill({ status: 200, json: { ok: true } })
					: route.continue(),
			);
			await openDeleteDialog(page);
			await page.keyboard.press('Tab');
			await page.keyboard.press('Enter');
			await expect(page.getByRole('button', { name: ACTIONS, exact: true })).toHaveCount(0);
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

	for (const dismiss of ['Escape', 'Abbrechen'] as const) {
		test(`${dismiss} returns focus to the row actions`, async ({ page }) => {
			await openDeleteDialog(page);
			if (dismiss === 'Escape') await page.keyboard.press('Escape');
			else await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
			await expect(page.getByRole('alertdialog')).toHaveCount(0);
			await expect(page.getByRole('button', { name: ACTIONS, exact: true })).toBeFocused();
		});
	}
});
