import { expect, test } from '@playwright/test';

test.describe('live public dashboard entry', () => {
	test.skip(
		process.env.PUBLIC_ENTRY_E2E !== 'true',
		'Requires an explicitly selected public deployment.',
	);
	test.describe.configure({ retries: 0 });

	test('visitors can explore before choosing to create a WG', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(new URL('/', process.env.BASE_URL).href);
		await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toBeVisible();
		await page.getByRole('navigation').getByRole('link', { name: 'Ausgaben', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Ausgaben', exact: true, level: 1 }),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Ausgaben', exact: true, level: 1 }),
		).toBeVisible();
	});

	test('creation is explicit and exposes credential choices without creating a WG', async ({
		page,
	}) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'WG erstellen', exact: true }).click();
		await expect(page).toHaveURL(/\/neu\?action=create$/);
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
		await expect(page.getByLabel('Passwort')).toBeVisible();
		await expect(page.getByLabel('Telefonnummer')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Mit Google anmelden', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG erstellen', exact: true })).toHaveCount(0);
	});

	test('an invitation survives public navigation and enters join only after selection', async ({
		page,
	}) => {
		const code = 'ABCD2345';
		await page.goto(`/?code=${code}`);
		await expect(
			page.getByRole('link', { name: 'Dieser WG beitreten', exact: true }),
		).toHaveAttribute('href', `/neu?code=${code}`);
		await page.getByRole('navigation').getByRole('link', { name: 'Einkauf', exact: true }).click();
		await expect(page).toHaveURL(`/entdecken/einkauf?code=${code}`);
		await page.reload();
		await page.getByRole('link', { name: 'Dieser WG beitreten', exact: true }).first().click();
		await expect(page).toHaveURL(`/neu?code=${code}`);
		await expect(
			page.getByText('Melde dich an, danach kannst du mit deinem Einladungscode beitreten.'),
		).toBeVisible();
	});

	test('old browser history and private deep links cannot bypass account checks', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem(
				'manawg_known_wgs',
				JSON.stringify([
					{ code: 'ZZZZZZZZ', name: 'Old browser history', lastVisitedAt: Date.now() },
				]),
			);
		});
		await page.goto('/');
		await expect(page.getByText('Old browser history')).toHaveCount(0);
		await page.goto('/wg/ZZZZZZZZ/ausgaben');
		await expect(page).toHaveURL(/\/neu\?next=/);
		expect(new URL(page.url()).searchParams.get('next')).toBe('/wg/ZZZZZZZZ/ausgaben');
	});
});
