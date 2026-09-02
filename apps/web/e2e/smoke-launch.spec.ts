import { type Page, expect, test } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';

type QaAuthConfig = {
	url: string;
	publishableKey: string;
	email: string;
	password: string;
};

function getQaAuthConfig(): QaAuthConfig | null {
	const url = process.env.E2E_SUPABASE_URL?.trim();
	const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY?.trim();
	const email = process.env.E2E_SUPABASE_TEST_EMAIL?.trim();
	const password = process.env.E2E_SUPABASE_TEST_PASSWORD;

	if (!url || !publishableKey || !email || !password) {
		return null;
	}

	return { url, publishableKey, email, password };
}

async function authenticateQaUser(
	page: Page,
	{ url, publishableKey, email, password }: QaAuthConfig,
) {
	const sessionCookies = new Map<string, string>();
	const supabase = createServerClient(url, publishableKey, {
		cookies: {
			getAll: () => [],
			setAll: (cookies) => {
				for (const { name, value } of cookies) sessionCookies.set(name, value);
			},
		},
	});
	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	if (error || !data.session) {
		throw new Error(
			`The real Supabase QA user could not sign in${error ? `: ${error.message}` : ''}.`,
		);
	}

	if (!sessionCookies.size) {
		throw new Error('Supabase SSR did not emit session cookies for the real QA user.');
	}

	await page.context().addCookies(
		[...sessionCookies].map(([name, value]) => ({
			name,
			value,
			url: new URL(page.url()).origin,
		})),
	);
}

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
	const qaAuthConfig = getQaAuthConfig();
	const requiresRealProductAuth =
		process.env.PREVIEW_E2E === 'true' || process.env.REAL_PRODUCT_E2E === 'true';

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

	test('404 page provides a valid keyboard skip target', async ({ page }) => {
		await gotoWithRetry(page, '/this-page-does-not-exist');
		await expect(page.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Zum Hauptinhalt springen' })).toHaveAttribute(
			'href',
			'#main',
		);
		await expect(page.locator('main#main')).toHaveCount(1);
	});

	test('create WG → redirect to /wg/<code> → dashboard renders module tiles', async ({ page }) => {
		if (!qaAuthConfig) {
			if (!requiresRealProductAuth) {
				test.skip(
					true,
					'real Supabase QA credentials are only required for the real-product smoke job',
				);
				return;
			}
			throw new Error(
				'real-product smoke requires E2E_SUPABASE_URL, E2E_SUPABASE_PUBLISHABLE_KEY, E2E_SUPABASE_TEST_EMAIL, and E2E_SUPABASE_TEST_PASSWORD',
			);
		}

		let createdShareCode: string | null = null;
		try {
			// Step 1: Land on /neu
			await page.addInitScript(() => window.localStorage.clear());
			await gotoWithRetry(page, '/neu');
			await authenticateQaUser(page, qaAuthConfig);
			await expect(page.getByRole('heading', { name: 'Loslegen' })).toBeVisible({
				timeout: 30_000,
			});

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
			const codeButton = page.getByRole('button', { name: /Code [A-Z0-9]{8} kopieren/ });
			await expect(codeButton).toBeVisible({
				timeout: 30_000,
			});
			createdShareCode =
				(await codeButton.getAttribute('aria-label'))?.match(/\b([A-Z0-9]{8})\b/)?.[1] ?? null;
			expect(createdShareCode).toMatch(/^[A-Z0-9]{8}$/);

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
		} finally {
			if (createdShareCode) {
				const cleanup = await page.request.delete(`/api/wg/${createdShareCode}`);
				expect(cleanup.status()).toBe(200);
			}
		}
	});
});
