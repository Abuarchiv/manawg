import { expect, test } from '@playwright/test';

test.describe('new WG form accessibility fixture', () => {
	test.skip(
		process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
		'Requires the database-down fixture server.',
	);

	test('moves focus between steps and keeps server errors form-level', async ({ page }) => {
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ wgs: [] }),
			}),
		);
		await page.route('**/api/wg', async (route) => {
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'server_error' }),
				});
				return;
			}
			await route.continue();
		});

		await page.goto('/neu');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();

		const wgName = page.getByLabel('WG-Name');
		const creatorName = page.getByLabel('Dein Anzeigename');
		await expect(wgName).toBeFocused();
		await expect(wgName).toHaveAttribute('required', '');
		await expect(creatorName).toHaveAttribute('required', '');

		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();
		await expect(wgName).toHaveAttribute('aria-invalid', 'true');
		await expect(creatorName).toHaveAttribute('aria-invalid', 'false');

		await wgName.fill('Fixture WG');
		await creatorName.fill('Fixture User');
		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();
		const formAlert = page.locator('#create-wg-form-error');
		await expect(formAlert).toContainText('WG konnte nicht erstellt werden');
		await expect(formAlert).toHaveAttribute('role', 'alert');
		await expect(wgName).toHaveAttribute('aria-invalid', 'false');
		await expect(creatorName).toHaveAttribute('aria-invalid', 'false');

		await page.getByRole('button', { name: 'Zurück', exact: true }).click();
		await page.getByRole('button', { name: 'Per Code beitreten', exact: true }).click();
		const joinCode = page.locator('#join-code');
		await expect(joinCode).toBeFocused();
		await expect(joinCode).toHaveAttribute('required', '');

		await joinCode.fill('MTE8PZAT');
		await page.getByRole('button', { name: 'WG-Code prüfen', exact: true }).click();
		await expect(page.getByLabel('Dein Anzeigename')).toBeFocused();
		await expect(page.getByLabel('Dein Anzeigename')).toHaveAttribute('required', '');
	});
});
