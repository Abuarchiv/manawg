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
	// The dialog moves focus to Abbrechen once it opens; a Tab pressed before that lands elsewhere.
	await expect(page.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
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
			const listPath = `/api/wg/${SHARE_CODE}/expenses`;
			let deletedId: string | undefined;
			await page.route(`**${listPath}/*`, (route) => {
				if (route.request().method() !== 'DELETE') return route.continue();
				deletedId = new URL(route.request().url()).pathname.split('/').pop();
				return route.fulfill({ status: 200, json: { ok: true } });
			});
			// The fixture server never sees the mocked delete, so the list it returns for the refetch
			// after the delete still holds the row. Answer the refetch as the real server would.
			await page.route(
				(url) => url.pathname === listPath,
				async (route) => {
					if (!deletedId || route.request().method() !== 'GET') return route.continue();
					const response = await route.fetch();
					const body = (await response.json()) as { expenses: { id: string }[] };
					const expenses = body.expenses.filter((expense) => expense.id !== deletedId);
					return route.fulfill({ response, json: { ...body, expenses } });
				},
			);
			await openDeleteDialog(page);
			const refetch = page.waitForResponse(
				(response) =>
					!!deletedId &&
					response.request().method() === 'GET' &&
					new URL(response.url()).pathname === listPath,
			);
			await page.keyboard.press('Tab');
			await page.keyboard.press('Enter');
			// Check after the refetch has rendered, not only in the gap before it lands.
			await (await refetch).finished();
			await page.evaluate(
				() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100))),
			);
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
