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
		await expect(
			page.getByRole('heading', { name: 'Euer WG-Alltag. Gemeinsam geregelt.', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toBeVisible();
		const examples = page.getByRole('region', { name: 'So kann euer Alltag aussehen' });
		await expect(examples).toBeVisible();
		await expect(page.locator('[data-liquid-glass]')).toHaveCount(3);
		await expect(page.locator('[data-slot="card"][data-liquid-glass]')).toHaveCount(0);
		for (const label of ['Einkauf', 'Ausgaben', 'Putzen', 'Pinnwand']) {
			await expect(examples.getByRole('article', { name: `${label}, Beispiel-WG` })).toBeVisible();
		}
		await expect(page.getByText('Weitere Bereiche', { exact: true })).toHaveCount(0);
		await page
			.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' })
			.getByRole('link', { name: 'Finanzen', exact: true })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Ausgaben', exact: true, level: 1 }),
		).toBeVisible();
		await expect(page.getByRole('article', { name: 'Ausgaben, Beispiel-WG' })).toBeVisible();
		await expect(page.getByText('Pizzaabend', { exact: true })).toBeVisible();
		await expect(page.locator('[data-liquid-glass]')).toHaveCount(4);
		await expect(page.locator('[data-slot="card"][data-liquid-glass]')).toHaveCount(0);
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
		await page.getByRole('tab', { name: 'Telefon / SMS', exact: true }).click();
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
		await page
			.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' })
			.getByRole('link', { name: 'Haushalt', exact: true })
			.click();
		await expect(page).toHaveURL(`/entdecken/einkauf?code=${code}`);
		await expect(
			page.getByRole('link', { name: 'Alle Bereiche ansehen', exact: true }),
		).toHaveAttribute('href', `/?code=${code}`);
		await page.reload();
		await page.getByRole('link', { name: 'Dieser WG beitreten', exact: true }).first().click();
		await expect(page).toHaveURL(`/neu?code=${code}`);
		await expect(
			page.getByText('Melde dich an, danach kannst du mit deinem Einladungscode beitreten.'),
		).toBeVisible();
	});

	test('membership lookup failures stay visible and can be retried', async ({ page }) => {
		let attempts = 0;
		await page.route('**/api/wg/mine', async (route) => {
			attempts += 1;
			if (attempts === 1) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'db_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'auth_required' }),
			});
		});
		await page.goto('/');
		await expect(page.getByText('Deine WGs konnten gerade nicht geladen werden.')).toBeVisible();
		await page.getByRole('button', { name: 'erneut prüfen', exact: true }).click();
		await expect.poll(() => attempts).toBeGreaterThan(1);
		await expect(page.getByText('Hafermilch', { exact: true })).toBeVisible();
	});

	test('uses semantic preset colors and respects reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/');
		await expect(
			page.getByRole('heading', { name: 'Euer WG-Alltag. Gemeinsam geregelt.', exact: true }),
		).toBeVisible();
		const customAccent = await page.locator('main').evaluate((element) => {
			const styles = getComputedStyle(element);
			return ['--public-accent', '--public-accent-strong', '--public-accent-soft'].some(
				(name) => styles.getPropertyValue(name).trim().length > 0,
			);
		});
		expect(customAccent).toBe(false);
		await expect(page.locator('main > div').first()).toHaveCSS('opacity', '1');
	});

	test('keeps a readable opaque material fallback for high contrast', async ({ page }) => {
		await page.emulateMedia({ forcedColors: 'active', contrast: 'more' });
		await page.goto('/');
		const material = page.locator('[data-liquid-glass]').first();
		await expect(material).toBeVisible();
		const fallback = await material.evaluate((element) => {
			const layer = element.firstElementChild;
			if (!(layer instanceof HTMLElement)) return null;
			const styles = getComputedStyle(layer);
			return {
				backgroundColor: styles.backgroundColor,
				backgroundImage: styles.backgroundImage,
			};
		});
		expect(fallback).not.toBeNull();
		expect(fallback?.backgroundImage).toBe('none');
		expect(fallback?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
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
