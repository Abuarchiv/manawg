import { type Page, expect, test } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';

type CreatedWgResponse = {
	wg?: { id?: unknown; shareCode?: unknown };
	creator?: { id?: unknown };
};

type WgManifestResponse = {
	wg?: { id?: unknown; shareCode?: unknown };
	currentMember?: { memberId?: unknown; memberToken?: unknown };
};

type MineWgResponse = {
	wgs?: Array<{ id?: unknown; memberId?: unknown; name?: unknown; code?: unknown }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QaAuthConfig = {
	url: string;
	publishableKey: string;
	email: string;
	password: string;
};

function getQaAuthConfig(env: NodeJS.ProcessEnv = process.env): QaAuthConfig | null {
	const url = env.E2E_SUPABASE_URL?.trim();
	const publishableKey = env.E2E_SUPABASE_PUBLISHABLE_KEY?.trim();
	const email = env.E2E_SUPABASE_TEST_EMAIL?.trim();
	const password = env.E2E_SUPABASE_TEST_PASSWORD?.trim();

	if (!url || !publishableKey || !email || !password) {
		return null;
	}

	return { url, publishableKey, email, password };
}

test('trims the real Supabase QA password loaded from the environment', () => {
	const config = getQaAuthConfig({
		E2E_SUPABASE_URL: ' https://example.supabase.co/ ',
		E2E_SUPABASE_PUBLISHABLE_KEY: ' publishable-key ',
		E2E_SUPABASE_TEST_EMAIL: ' qa@example.com ',
		E2E_SUPABASE_TEST_PASSWORD: ' qa-password ',
	});

	expect(config?.password).toBe('qa-password');
});

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

function getRunNamespace(): string {
	const runId = process.env.GITHUB_RUN_ID?.trim();
	const attempt = process.env.GITHUB_RUN_ATTEMPT?.trim();
	return runId && attempt ? `run-${runId}-${attempt}` : `local-${Date.now()}`;
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

	test('shows joining disabled after a member join attempt', async ({ page }) => {
		let memberPostRequests = 0;
		const fixtureMode = process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE === 'true';
		await page.addInitScript(() => window.localStorage.clear());
		// This existing mocked invite-policy test starts after account authentication.
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{"wgs":[]}' }),
		);
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
		if (!fixtureMode) {
			if (!qaAuthConfig) {
				test.skip(true, 'non-fixture smoke requires Supabase QA credentials');
				return;
			}
			await authenticateQaUser(page, qaAuthConfig);
			await page.reload();
		}
		await expect(page.getByRole('heading', { name: 'Per Code beitreten' })).toBeVisible({
			timeout: 30_000,
		});
		await page.getByRole('button', { name: 'WG-Code prüfen' }).click();

		if (fixtureMode) {
			await expect(page.getByText('Diese WG nimmt gerade keine neuen Beitritte an.')).toBeVisible();
			await expect(page.getByRole('button', { name: 'WG beitreten' })).toHaveCount(0);
			await expect.poll(() => memberPostRequests).toBe(0);
			return;
		}

		await expect(page.getByRole('heading', { name: 'Dein Name in der WG' })).toBeVisible();
		await page.getByLabel('Dein Anzeigename').fill('Smoke Tester');
		await page.getByRole('button', { name: 'WG beitreten', exact: true }).click();
		await expect(page.getByText('Diese WG nimmt gerade keine neuen Beitritte an.')).toBeVisible();
		await expect.poll(() => memberPostRequests).toBe(1);
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

	test('create WG → redirect to /wg/<code> → Start overview retains primary navigation', async ({
		page,
	}) => {
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

		const runNamespace = getRunNamespace();
		const wgName = `Smoke Test WG ${runNamespace}`;
		let createdShareCode: string | null = null;
		let createdWgId: string | null = null;
		let createdMemberId: string | null = null;
		let createClicked = false;
		let flowError: unknown = null;
		let cleanupFailure: string | null = null;
		try {
			// Step 1: Land on /neu
			await page.addInitScript(() => window.localStorage.clear());
			await gotoWithRetry(page, '/neu');
			await authenticateQaUser(page, qaAuthConfig);
			await page.reload();
			await expect(
				page.getByRole('heading', { name: 'Deine WG', exact: true, level: 1 }),
			).toBeVisible({
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
			await page.getByLabel('WG-Name').fill(wgName);
			await page.getByLabel('Dein Anzeigename').fill('Smoke Tester');

			// Step 4: Submit → invite step with a generated WG code
			const creationResponse = page.waitForResponse(
				(response) => response.url().endsWith('/api/wg') && response.request().method() === 'POST',
				{ timeout: 30_000 },
			);
			createClicked = true;
			await page.getByRole('button', { name: /^WG erstellen$/i }).click();
			const createdResponse = await creationResponse;
			expect(createdResponse.status()).toBe(200);
			const created = (await createdResponse.json()) as CreatedWgResponse;
			createdShareCode = typeof created.wg?.shareCode === 'string' ? created.wg.shareCode : null;
			createdWgId = typeof created.wg?.id === 'string' ? created.wg.id : null;
			createdMemberId = typeof created.creator?.id === 'string' ? created.creator.id : null;
			expect(createdShareCode).toMatch(/^[A-Z0-9]{8}$/);
			expect(created.wg?.id).toMatch(UUID_PATTERN);
			expect(created.creator?.id).toMatch(UUID_PATTERN);
			expect(created.wg?.shareCode).toBe(createdShareCode);

			await expect(page.getByRole('heading', { name: wgName, exact: true, level: 1 })).toBeVisible({
				timeout: 30_000,
			});
			const codeButton = page.getByRole('button', { name: /Code [A-Z0-9]{8} kopieren/ });
			await expect(codeButton).toBeVisible({
				timeout: 30_000,
			});
			const inviteCode =
				(await codeButton.getAttribute('aria-label'))?.match(/\b([A-Z0-9]{8})\b/)?.[1] ?? null;
			expect(inviteCode).toBe(createdShareCode);

			// Step 5: Continue to /wg/<8-char-code>; ManaWG share codes are 8 alphanumeric chars.
			await page.getByRole('button', { name: /direkt zur WG/i }).click();
			await page.waitForURL(/\/wg\/[A-Z0-9]{8}$/, { timeout: 15_000 });
			const manifestResponse = await page.request.get(`/api/wg/${createdShareCode}`);
			expect(manifestResponse.status()).toBe(200);
			const manifest = (await manifestResponse.json()) as WgManifestResponse;
			expect(manifest.wg?.id).toBe(createdWgId);
			expect(manifest.wg?.shareCode).toBe(createdShareCode);
			expect(manifest.currentMember?.memberId).toBe(createdMemberId);
			const memberToken =
				typeof manifest.currentMember?.memberToken === 'string'
					? manifest.currentMember.memberToken
					: null;
			if (!memberToken) throw new Error('created WG member token was not returned');
			const memberHeaders = { 'x-manawg-member-token': memberToken };

			const closeJoining = await page.request.patch(`/api/wg/${createdShareCode}`, {
				headers: memberHeaders,
				data: { joiningEnabled: false },
			});
			expect(closeJoining.status()).toBe(200);
			const existingMemberJoin = await page.request.post(`/api/wg/${createdShareCode}/members`, {
				data: { name: 'Smoke Tester' },
			});
			expect(existingMemberJoin.status()).toBe(409);
			expect(await existingMemberJoin.json()).toMatchObject({ code: 'already_joined' });

			// Step 6: The focused overview retains access to every primary destination.
			await expect(page.getByRole('heading', { name: /^Start – /, level: 1 })).toBeVisible({
				timeout: 30_000,
			});
			await expect(
				page.getByRole('heading', { name: `Start – ${wgName}`, exact: true }),
			).toBeVisible();
			const navigation = page.getByRole('navigation', { name: 'WG Hauptnavigation' });
			for (const label of ['Start', 'Haushalt', 'Finanzen', 'Austausch']) {
				await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible();
			}
		} catch (error) {
			flowError = error;
		} finally {
			if (!createdShareCode && createClicked) {
				try {
					const mineResponse = await page.request.get('/api/wg/mine');
					if (mineResponse.ok()) {
						const mine = (await mineResponse.json()) as MineWgResponse;
						const recovered = mine.wgs?.find((wg) => wg.name === wgName);
						if (
							recovered &&
							typeof recovered.code === 'string' &&
							/^[A-Z0-9]{8}$/.test(recovered.code) &&
							typeof recovered.id === 'string' &&
							UUID_PATTERN.test(recovered.id) &&
							typeof recovered.memberId === 'string' &&
							UUID_PATTERN.test(recovered.memberId)
						) {
							createdShareCode = recovered.code;
							createdWgId = recovered.id;
							createdMemberId = recovered.memberId;
						}
					}
				} catch {
					// Cleanup below reports the run namespace without leaking response data.
				}
			}
			if (createdShareCode) {
				try {
					const cleanup = await page.request.delete(`/api/wg/${createdShareCode}`, {
						headers: memberHeaders,
					});
					const [wgAfterCleanup, membersAfterCleanup] = await Promise.all([
						page.request.get(`/api/wg/${createdShareCode}`),
						page.request.get(`/api/wg/${createdShareCode}/members`),
					]);
					const cleanupFailed =
						cleanup.status() !== 200 ||
						wgAfterCleanup.status() !== 404 ||
						membersAfterCleanup.status() !== 404;
					if (cleanupFailed) {
						cleanupFailure = `WG cleanup failed for run namespace ${runNamespace}, share code ${createdShareCode}.`;
					}
				} catch {
					cleanupFailure = `WG cleanup failed for run namespace ${runNamespace}, share code ${createdShareCode}.`;
				}
			} else if (createClicked) {
				cleanupFailure = `WG cleanup failed for run namespace ${runNamespace}, share code unavailable.`;
			}
		}
		if (cleanupFailure) throw new Error(cleanupFailure);
		if (flowError) throw flowError;
	});
});
