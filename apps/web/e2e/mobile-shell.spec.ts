import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			if ((await page.locator('body').innerText()).includes('Internal Server Error')) {
				throw new Error('Next dev server returned Internal Server Error');
			}
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1500);
		}
	}
	throw lastError;
}

async function seedIdentity(page: Page) {
	await page.evaluate(() => {
		localStorage.setItem(
			'manawg_identity:989ac820-58b7-431f-9c65-28721264f333',
			JSON.stringify({ memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973', name: 'dsaf' }),
		);
	});
}

async function expectNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(2);
}

test.describe('Mobile WG shell', () => {
	test.setTimeout(300_000);

	test.use({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});

	test('dashboard and subpage fit mobile width with bottom navigation', async ({ page }) => {
		await gotoWithRetry(page, '/wg/MTE8PZAT');
		await seedIdentity(page);
		await page.reload({ waitUntil: 'domcontentloaded' });

		const bottomNav = page.getByRole('navigation', { name: 'WG Hauptnavigation' });
		await expect(bottomNav).toBeVisible({
			timeout: 30_000,
		});
		await expect(bottomNav.locator('[data-liquid-glass]')).toHaveCount(1);
		await expect(page.locator('header [data-liquid-glass]')).toHaveCount(0);
		await expect(bottomNav.getByRole('link', { name: /^Start$/ })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(page.getByRole('heading', { name: 'Heute wichtig' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('region', { name: 'Module' })).toHaveCount(0);

		await expectNoHorizontalOverflow(page);

		await bottomNav.getByRole('link', { name: /^Austausch$/ }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/pinnwand$/, { timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Pinnwand' })).toBeVisible({
			timeout: 60_000,
		});
		await expect(bottomNav.getByRole('link', { name: /^Austausch$/ })).toHaveAttribute(
			'aria-current',
			'page',
		);
		await expect(page.getByRole('navigation', { name: 'WG Schnellzugriff' })).toHaveCount(0);

		// Kein Sammelmenü mehr: jeder Nebenbereich hängt an seiner Modulseite.
		await expect(bottomNav.getByRole('button', { name: 'Mehr-Menü öffnen' })).toHaveCount(0);

		// Pinnwand → Kalender und wieder zurück.
		const calendarLink = page.getByRole('link', { name: /Termine im Kalender öffnen/ });
		await expect(calendarLink).toBeVisible({ timeout: 30_000 });
		await calendarLink.click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/kalender$/, { timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Kalender', exact: true })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('link', { name: 'Zurück zu Haushalt' }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/einkauf$/, { timeout: 60_000 });

		// Einkauf → Vorräte.
		await bottomNav.getByRole('link', { name: /^Haushalt$/ }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/einkauf$/, { timeout: 60_000 });
		const householdNav = page.locator('nav[data-wg-local-nav]').filter({
			has: page.getByRole('link', { name: /^Vorräte$/ }),
		});
		await expect(householdNav).toBeVisible();
		await householdNav.getByRole('link', { name: /^Vorräte$/ }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/vorraete$/, { timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible({
			timeout: 30_000,
		});

		// Ausgaben → Fixkosten und Mahnungen.
		await bottomNav.getByRole('link', { name: /^Finanzen$/ }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/ausgaben$/, { timeout: 60_000 });
		const ausgabenSubNav = page.getByRole('navigation', { name: 'Unterbereiche der Finanzen' });
		await expect(ausgabenSubNav.getByRole('link', { name: /^Fixkosten/ })).toBeVisible({
			timeout: 30_000,
		});
		await expect(ausgabenSubNav.locator('[data-liquid-glass]')).toHaveCount(0);
		await ausgabenSubNav.getByRole('link', { name: /^Mahnungen/ }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/mahnungen$/, { timeout: 60_000 });
		await page.getByRole('link', { name: 'Zurück zu Ausgaben' }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/ausgaben$/, { timeout: 60_000 });

		await expectNoHorizontalOverflow(page);
	});

	test('all primary WG pages avoid horizontal overflow on mobile', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		for (const path of [
			'/wg/MTE8PZAT',
			'/wg/MTE8PZAT/ausgaben',
			'/wg/MTE8PZAT/einkauf',
			'/wg/MTE8PZAT/pinnwand',
			'/wg/MTE8PZAT/putzen',
			'/wg/MTE8PZAT/suche',
			'/wg/MTE8PZAT/aktivitaet',
			'/wg/MTE8PZAT/einstellungen',
		]) {
			await gotoWithRetry(page, path);
			await expect(page.getByRole('navigation', { name: 'WG Hauptnavigation' })).toBeVisible({
				timeout: 30_000,
			});
			if (path !== '/wg/MTE8PZAT') {
				await expect(page.getByRole('navigation', { name: 'WG Schnellzugriff' })).toHaveCount(0);
			}
			if (path === '/wg/MTE8PZAT') {
				await expect(
					page.getByRole('link', { name: 'Konto und WG-Einstellungen öffnen' }),
				).toBeVisible({
					timeout: 30_000,
				});
			}
			if (path === '/wg/MTE8PZAT/aktivitaet') {
				await expect(page.getByRole('link', { name: 'Zurück zu Dashboard' })).toBeVisible({
					timeout: 30_000,
				});
			}
			await expectNoHorizontalOverflow(page);
		}
	});
});
