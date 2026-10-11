// Hosted public entry (Supabase) live lane; CI references this file by name.
// Why: only hosted evidence that public exploration, create/join choices and private deep-link protection work against real Supabase.

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
			page.getByRole('heading', { name: 'ManaWG', exact: true, level: 1 }),
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Konto erstellen', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toHaveCount(0);
		const examples = page.getByRole('region', { name: 'So kann euer Alltag aussehen' });
		await expect(examples).toBeVisible();
		await expect(page.locator('[data-liquid-glass]')).toHaveCount(0);
		for (const label of ['Einkäufe', 'Ausgaben', 'Putzplan', 'Pinnwand']) {
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
		await expect(page.locator('[data-liquid-glass]')).toHaveCount(0);
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Ausgaben', exact: true, level: 1 }),
		).toBeVisible();
	});

	test('creation is explicit and exposes credential choices without creating a WG', async ({
		page,
	}) => {
		await page.goto('/');
		// Account first: the guest start page offers registration; sign-in sits in the header.
		await expect(page.getByRole('link', { name: 'Konto erstellen', exact: true })).toHaveAttribute(
			'href',
			'/registrieren',
		);
		await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
		await expect(page).toHaveURL(/\/neu$/);
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
		await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
		await expect(page.getByLabel('Passwort', { exact: true })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Mit Google anmelden', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG erstellen', exact: true })).toHaveCount(0);

		// Registration has its own page; short passwords are rejected before any sign-up request.
		await page.getByRole('link', { name: 'Konto erstellen', exact: true }).click();
		await expect(page).toHaveURL(/\/registrieren$/);
		let signUpRequests = 0;
		await page.route(
			(url) => url.pathname === '/api/auth/sign-up',
			async (route) => {
				signUpRequests += 1;
				await route.abort();
			},
		);
		const passwordWarning = page
			.getByRole('alert')
			.filter({ hasText: 'Dein Passwort braucht mindestens 8 Zeichen.' });
		for (const short of ['12345', '1234567']) {
			await page.getByLabel('E-Mail-Adresse').fill('kurz@example.invalid');
			await page.getByLabel('Passwort', { exact: true }).fill(short);
			await page.getByLabel('Passwort wiederholen').fill(short);
			await page.getByRole('button', { name: 'Konto erstellen', exact: true }).click();
			await expect(passwordWarning).toBeVisible();
		}
		expect(signUpRequests).toBe(0);
	});

	test('an invitation survives public navigation and enters join only after selection', async ({
		page,
	}) => {
		const token = 'aB3_-xYz09aB3_-xYz09kQ';
		await page.goto(`/?invite=${token}`);
		await expect(
			page.getByRole('link', { name: 'Einladung annehmen', exact: true }),
		).toHaveAttribute('href', `/einladung/${token}`);
		await page
			.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' })
			.getByRole('link', { name: 'Haushalt', exact: true })
			.click();
		await expect(page).toHaveURL(`/entdecken/einkauf?invite=${token}`);
		await expect(
			page
				.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' })
				.getByRole('link', { name: 'Start', exact: true }),
		).toHaveAttribute('href', `/?invite=${token}`);
		await page.reload();
		await page.getByRole('link', { name: 'Einladung annehmen', exact: true }).first().click();
		await expect(page).toHaveURL(`/einladung/${token}`);
		await expect(page.getByText('Melde dich an, um der WG beizutreten.')).toBeVisible();
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
		await page.getByRole('button', { name: 'Erneut prüfen', exact: true }).click();
		await expect.poll(() => attempts).toBeGreaterThan(1);
		await expect(page.getByText('Hafermilch', { exact: true })).toBeVisible();
	});

	test('keeps web navigation opaque in high contrast', async ({ page }) => {
		await page.emulateMedia({ forcedColors: 'active', contrast: 'more' });
		await page.goto('/');
		const material = page.getByRole('navigation', { name: 'Öffentliche Hauptnavigation' });
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
