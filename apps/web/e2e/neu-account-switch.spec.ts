import { expect, test } from '@playwright/test';

test.describe('Neu account switch state reset', () => {
	test.skip(
		!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
		'Requires the configured Supabase browser client.',
	);

	test('does not restore the previous account draft after switching accounts', async ({ page }) => {
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ wgs: [] }),
			}),
		);
		await page.route('**/auth/v1/logout', (route) => route.fulfill({ status: 204, body: '' }));

		await page.goto('/neu');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await page.getByLabel('WG-Name').fill('Altes Konto');
		await page.getByLabel('Dein Anzeigename').fill('Altes Profil');
		await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
		await page.reload();
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await expect(page.getByLabel('WG-Name')).toHaveValue('');
		await expect(page.getByLabel('Dein Anzeigename')).toHaveValue('');
	});
});
