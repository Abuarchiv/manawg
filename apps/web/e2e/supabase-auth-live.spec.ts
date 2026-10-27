// Hosted Supabase auth release coverage and password-reset smoke; CI references this file by name.
// Why: guests must not reach private WGs and account switching must work against the real auth backend.

import { expect, test } from '@playwright/test';

const liveEnabled = process.env.SUPABASE_AUTH_LIVE_E2E === 'true';
const passwordResetEnabled = process.env.SUPABASE_AUTH_PASSWORD_RESET_SMOKE === 'true';
const baseUrl = process.env.BASE_URL?.trim() ?? '';

function isHostedHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			!['localhost', '127.0.0.1', '::1'].includes(url.hostname) &&
			!url.hostname.endsWith('.local')
		);
	} catch {
		return false;
	}
}

const hostedHttps = isHostedHttpsUrl(baseUrl);
const testEmail = process.env.SUPABASE_AUTH_TEST_EMAIL?.trim() ?? '';
const testPassword = process.env.SUPABASE_AUTH_TEST_PASSWORD ?? '';
const memberWgCode = process.env.SUPABASE_AUTH_TEST_MEMBER_WG_CODE?.trim().toUpperCase() ?? '';
const memberInviteToken = process.env.SUPABASE_AUTH_TEST_MEMBER_INVITE_TOKEN?.trim() ?? '';
const credentialsReady =
	testEmail.length > 0 && testPassword.length >= 6 && memberWgCode.length > 0;

function requireMemberTestConfig(): void {
	expect(
		credentialsReady,
		'SUPABASE_AUTH_TEST_EMAIL, SUPABASE_AUTH_TEST_PASSWORD and SUPABASE_AUTH_TEST_MEMBER_WG_CODE are required for this live test.',
	).toBe(true);
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function hostedUrl(path: string): string {
	return new URL(path, baseUrl).href;
}

test.describe('hosted Supabase auth release coverage', () => {
	test.skip(!liveEnabled, 'Disabled. Set SUPABASE_AUTH_LIVE_E2E=true to opt in.');
	test.skip(
		!hostedHttps,
		'Requires BASE_URL to be an explicit HTTPS deployment URL; localhost is never allowed.',
	);
	test.describe.configure({ retries: 0 });

	test('the guest auth screen exposes only the supported Supabase choices', async ({ page }) => {
		await page.goto('/neu?action=create');
		await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Mit Google anmelden', exact: true }),
		).toBeVisible();
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
		await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Passwort', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: /Apple|Facebook/i })).toHaveCount(0);
		await expect(page.locator('input[name="name"], input[name="code"]')).toHaveCount(0);
		await expect(page.getByText(/lokal|Name-Code|Namencode/i)).toHaveCount(0);
		await expect(page.getByRole('button', { name: /Apple|Facebook/i })).toHaveCount(0);
		await expect(page.locator('input[name="name"], input[name="code"]')).toHaveCount(0);
		await expect(page.getByText(/lokal|Name-Code|Namencode/i)).toHaveCount(0);
	});

	test('an unauthenticated guest cannot reach a private WG or receive WG metadata', async ({
		page,
	}) => {
		const privateCode = memberWgCode || 'ZZZZZZZZ';
		await page.goto(`/wg/${encodeURIComponent(privateCode)}/ausgaben`);
		await expect(page).toHaveURL(/\/neu\?next=/);
		const next = new URL(page.url()).searchParams.get('next');
		expect(next).toBe(`/wg/${privateCode}/ausgaben`);

		await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
		await expect(page.getByText('WG-Einladung')).toHaveCount(0);

		const apiResult = await page.evaluate(async (code) => {
			const response = await fetch(`/api/wg/${encodeURIComponent(code)}`, {
				cache: 'no-store',
				credentials: 'same-origin',
			});
			return { status: response.status, body: await response.text() };
		}, privateCode);
		expect([401, 403, 404]).toContain(apiResult.status);
		expect(apiResult.body).not.toMatch(/"(?:members|name|shareCode|currentMember)"/);
	});

	test('an authenticated guest can switch accounts before following an invite', async ({
		page,
	}) => {
		requireMemberTestConfig();

		await page.goto('/neu?action=create');
		await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
		await page.getByLabel('E-Mail-Adresse').fill(testEmail);
		await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill(testPassword);
		await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neue WG erstellen' })).toBeVisible({
			timeout: 20_000,
		});

		await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
	});

	test('a normal account session cannot open the password reset form', async ({ page }) => {
		requireMemberTestConfig();

		await page.goto('/neu?action=create');
		await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
		await page.getByLabel('E-Mail-Adresse').fill(testEmail);
		await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill(testPassword);
		await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Neue WG erstellen' })).toBeVisible({
			timeout: 20_000,
		});

		await page.goto('/auth/reset');
		await expect(page.getByRole('main').getByRole('alert')).toContainText(
			'ungültig oder abgelaufen',
		);
		await expect(page.getByLabel('Neues Passwort')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Passwort speichern' })).toHaveCount(0);
	});

	test('an existing member opening an invitation to their WG lands in it without joining', async ({
		page,
	}) => {
		requireMemberTestConfig();
		test.skip(
			memberInviteToken === '',
			'Set SUPABASE_AUTH_TEST_MEMBER_INVITE_TOKEN to a live invitation token of the member WG.',
		);

		const mutationRequests: string[] = [];
		page.on('request', (request) => {
			const url = new URL(request.url());
			if (request.method() !== 'GET' && url.pathname.startsWith('/api/wg')) {
				mutationRequests.push(`${request.method()} ${url.pathname}`);
			}
		});

		await page.goto(`/einladung/${memberInviteToken}`);
		await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
		await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
		await page.getByLabel('E-Mail-Adresse').fill(testEmail);
		await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill(testPassword);
		await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

		await expect(page).toHaveURL(hostedUrl(`/wg/${memberWgCode}`), { timeout: 30_000 });
		expect(mutationRequests).toEqual([]);
	});
});

test.describe('hosted password-reset UI smoke', () => {
	test.skip(!liveEnabled, 'Disabled. Set SUPABASE_AUTH_LIVE_E2E=true to opt in.');
	test.skip(
		!hostedHttps,
		'Requires BASE_URL to be an explicit HTTPS deployment URL; localhost is never allowed.',
	);
	test.skip(
		!passwordResetEnabled,
		'Skipped by default: set SUPABASE_AUTH_PASSWORD_RESET_SMOKE=true to check the no-session reset UI. No email is sent.',
	);
	test.describe.configure({ retries: 0 });

	test('rejects a reset page without a recovery session without sending email', async ({
		page,
	}) => {
		await page.goto('/auth/reset');
		await expect(page.getByRole('main').getByRole('alert')).toContainText(
			'ungültig oder abgelaufen',
		);
		await expect(page.getByLabel('Neues Passwort')).toHaveCount(0);
	});
});
