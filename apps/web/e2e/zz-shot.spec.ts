import { expect, test } from '@playwright/test';

test('shot', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/registrieren');
	const pw = page.getByLabel('Passwort', { exact: true });
	await pw.fill('geheim123');
	await page.getByRole('button', { name: 'Passwort anzeigen' }).first().click();
	await expect(pw).toHaveAttribute('type', 'text');
	await page.screenshot({ path: '/private/tmp/claude-501/-Users-abu-Company/eefa649f-0591-4edb-8348-429a7caf13b7/scratchpad/reg.png' });
});
