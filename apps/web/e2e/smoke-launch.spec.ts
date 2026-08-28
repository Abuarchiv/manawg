import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

/**
 * Smoke test for the core launch flow:
 * /neu → choose "Neue WG erstellen" → fill form → invite step → /wg/<code> dashboard
 */
test.describe('ManaWG launch smoke', () => {
	test.setTimeout(300_000);

	test('stops invite-code joins before name entry when new joins are disabled', async ({
		page,
	}) => {
		let memberPostRequests = 0;
		await page.addInitScript(() => window.localStorage.clear());
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					wg: {
						id: '989ac820-58b7-431f-9c65-28721264f333',
						name: 'sadf',
						shareCode: 'MTE8PZAT',
						joiningEnabled: false,
						shareCodeRotatedAt: null,
						createdAt: new Date().toISOString(),
					},
					members: [],
				}),
			});
		});
		await page.route('**/api/wg/MTE8PZAT/members', async (route) => {
			if (route.request().method() === 'POST') memberPostRequests += 1;
			await route.fulfill({
				status: 403,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'joining_disabled' }),
			});
		});

		await gotoWithRetry(page, '/neu?code=MTE8PZAT');
		await expect(page.getByRole('heading', { name: 'Per Code beitreten' })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'WG-Code prüfen' }).click();

		await expect(page.getByText('Diese WG nimmt gerade keine neuen Beitritte an.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG beitreten' })).toHaveCount(0);
		await expect.poll(() => memberPostRequests).toBe(0);
	});

	test('create WG → redirect to /wg/<code> → dashboard renders module tiles', async ({ page }) => {
		// Step 1: Land on /neu
		await page.addInitScript(() => window.localStorage.clear());
		await gotoWithRetry(page, '/neu');
		await expect(page.getByRole('heading', { name: 'Loslegen' })).toBeVisible({ timeout: 30_000 });

		// Step 2: Choose "Neue WG erstellen"
		const createChoice = page.getByRole('button', { name: /Neue WG erstellen/i });
		for (let attempt = 0; attempt < 10; attempt += 1) {
			await createChoice.click();
			if (
				await page
					.getByLabel('WG-Name')
					.isVisible({ timeout: 1_000 })
					.catch(() => false)
			) {
				break;
			}
		}
		await expect(page.getByLabel('WG-Name')).toBeVisible({ timeout: 30_000 });

		// Step 3: Fill WG name + creator name
		await page.getByLabel('WG-Name').fill('Smoke Test WG');
		await page.getByLabel('Dein Name').fill('Smoke Tester');

		// Step 4: Submit → invite step with a generated WG code
		await page.getByRole('button', { name: /^WG erstellen$/i }).click();
		await expect(page.getByRole('heading', { name: 'Mitbewohner einladen' })).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByRole('button', { name: /Code [A-Z0-9]{8} kopieren/ })).toBeVisible({
			timeout: 30_000,
		});

		// Step 5: Continue to /wg/<8-char-code>; ManaWG share codes are 8 alphanumeric chars.
		await page.getByRole('button', { name: /direkt zur WG/i }).click();
		await page.waitForURL(/\/wg\/[A-Z0-9]{8}$/, { timeout: 15_000 });

		// Step 6: Verify dashboard renders module tiles (Ausgaben / Einkauf / Pinnwand)
		await expect(page.getByRole('heading', { name: 'Smoke Test WG' })).toBeVisible({
			timeout: 30_000,
		});
		const moduleNavigation = page.getByRole('region', { name: 'Module' });
		await expect(moduleNavigation.getByRole('link', { name: /^Ausgaben\b/ })).toBeVisible({
			timeout: 30_000,
		});
		await expect(moduleNavigation.getByRole('link', { name: /^Einkauf\b/ })).toBeVisible({
			timeout: 30_000,
		});
		await expect(moduleNavigation.getByRole('link', { name: /^Pinnwand\b/ })).toBeVisible({
			timeout: 30_000,
		});
	});
});
