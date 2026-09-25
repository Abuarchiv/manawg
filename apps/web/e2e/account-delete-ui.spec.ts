import { expect, test } from '@playwright/test';

async function openConfirmation(page: import('@playwright/test').Page) {
	await page.route('**/api/wg/mine', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ wgs: [] }),
		}),
	);
	await page.goto('/');
	await page.getByRole('button', { name: 'Konto dauerhaft löschen' }).click();
	await page.getByLabel('Tippe LÖSCHEN').fill('LÖSCHEN');
}

function fulfillDeletion(page: import('@playwright/test').Page, status: number) {
	return page.route('**/api/account', (route) =>
		route.request().method() === 'DELETE'
			? route.fulfill({
					status,
					contentType: 'application/json',
					body: JSON.stringify({ status: status === 202 ? 'pending' : 'completed' }),
				})
			: route.continue(),
	);
}

test('HTTP 200 signs out and returns to the entry page', async ({ page }) => {
	await fulfillDeletion(page, 200);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByText(/ManaWG hat deine Zugänge zu allen WGs entfernt/)).toHaveCount(0);
});

test('HTTP 202 signs out and announces that Auth deletion is pending', async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({ colorScheme: 'dark' });
	await fulfillDeletion(page, 202);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL(/accountDeletion=pending/);
	await expect(page.getByText(/ManaWG hat deine Zugänge zu allen WGs entfernt/)).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

test('a pre-commit server failure stays in the confirmation dialog', async ({ page }) => {
	await fulfillDeletion(page, 503);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(
		page.getByText('Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.'),
	).toBeVisible();
	await expect(page).toHaveURL('/');
});

test('localStorage removal failure does not turn an accepted deletion into an error', async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 720 });
	await page.emulateMedia({ colorScheme: 'light' });
	await page.addInitScript(() => {
		const removeItem = Storage.prototype.removeItem;
		Storage.prototype.removeItem = function (key: string) {
			if (key.startsWith('manawg')) throw new DOMException('Storage unavailable', 'SecurityError');
			return removeItem.call(this, key);
		};
	});
	await fulfillDeletion(page, 202);
	await openConfirmation(page);
	await page.getByRole('button', { name: 'Konto löschen', exact: true }).click();
	await expect(page).toHaveURL(/accountDeletion=pending/);
	await expect(page.getByText(/ManaWG hat deine Zugänge zu allen WGs entfernt/)).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});
