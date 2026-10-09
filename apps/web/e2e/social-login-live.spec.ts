// Hosted social-login entry live lane; CI references this file by name.
// Why: OAuth errors must keep a safe destination, reject external redirects and clear PKCE cookies; only verifiable against the real provider config.

import { expect, test } from '@playwright/test';
import { defined } from './support/helpers';

test.describe('live social-login entry', () => {
	test.skip(
		process.env.AUTH_LIVE_E2E !== 'true',
		'Requires an explicitly selected live deployment.',
	);
	test.describe.configure({ retries: 0 });

	test('the built browser login reads hosted Supabase Auth settings', async ({ page }) => {
		await page.goto('/neu');
		const [response] = await Promise.all([
			page.waitForResponse(
				(response) => {
					const url = new URL(response.url());
					return url.hostname.endsWith('.supabase.co') && url.pathname === '/auth/v1/settings';
				},
				{ timeout: 10_000 },
			),
			page.getByRole('button', { name: 'Mit Google anmelden', exact: true }).click(),
		]);
		expect(response.status()).toBe(200);
		const settings = (await response.json()) as { external: Record<string, boolean> };
		if (!settings.external.google) {
			await expect(page.getByRole('main').getByRole('alert')).toContainText(
				'Dieser Anmeldedienst ist gerade nicht verfügbar.',
			);
		}
		await expect(
			page.getByText('Anmeldung konnte nicht gestartet werden.', { exact: true }),
		).toHaveCount(0);
	});

	test('cancelled OAuth returns a visible error without losing the safe destination', async ({
		page,
	}) => {
		await page.goto('/auth/callback?error=access_denied&next=%2Fwg%2FZZZZZZZZ%2Fausgaben');
		await expect(page).toHaveURL(/\/neu\?error=auth_callback/);
		expect(new URL(page.url()).searchParams.get('next')).toBe('/wg/ZZZZZZZZ/ausgaben');
		await expect(page.getByRole('main').getByRole('alert')).toContainText(
			'Der Link konnte nicht verwendet werden.',
		);
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
	});

	test('OAuth error redirects reject external destinations', async ({ request }) => {
		const response = await request.get(
			'/auth/callback?error=access_denied&next=https%3A%2F%2Fexample.com',
			{ maxRedirects: 0 },
		);
		const destination = new URL(defined(response.headers().location, 'redirect location'));
		expect(destination.origin).toBe(new URL(response.url()).origin);
		expect(destination.pathname).toBe('/neu');
		expect(destination.searchParams.get('next')).toBe('/');
	});

	test('a failed OAuth flow clears its PKCE cookies', async ({ page }) => {
		const projectRef = new URL(
			process.env.E2E_SUPABASE_URL ?? 'https://bwsvsvfgbrsonepffqff.supabase.co',
		).hostname.split('.')[0];
		const storageKey = `sb-${projectRef}-auth-token`;
		const flowId = 'release-regression-flow';
		const slot = `${storageKey}-flow-${flowId}-code-verifier`;
		const index = `${storageKey}-flows-code-verifier`;
		const encode = (value: unknown) =>
			`base64-${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
		// No real account/token: an empty verifier fails before the token exchange.
		await page.context().addCookies([
			{ name: slot, value: encode(''), url: new URL('/', process.env.BASE_URL).href },
			{ name: index, value: encode([flowId]), url: new URL('/', process.env.BASE_URL).href },
		]);
		const response = await page.request.get(
			`/auth/callback?code=invalid-release-regression&sb_flow_id=${flowId}`,
			{
				maxRedirects: 0,
			},
		);
		const cookies = response
			.headersArray()
			.filter((header) => header.name.toLowerCase() === 'set-cookie');
		for (const name of [slot, index]) {
			expect(
				cookies.some(({ value }) => value.startsWith(`${name}=`) && /Max-Age=0/i.test(value)),
			).toBe(true);
		}
	});
});
