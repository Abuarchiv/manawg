// Sign-in / create-or-join entry flow (fixture lane): validation, tabs, code login, account switch.
// Live Supabase auth is covered by supabase-auth-live and social-login-live.

import { expect, test } from '@playwright/test';

import { FIXTURE_WG, mockNoWgs, skipUnlessDbDown } from './support/helpers';

const INVITE_TOKEN = 'fixture-invite-token01';

test.describe('start credentials auth validation', () => {
	test.describe('credentials auth form validation fixture', () => {
		skipUnlessDbDown();

		test('shows the custom error box instead of native browser validation', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: '{"error":"auth_required"}',
				}),
			);
			await page.goto('/login');
			await page.getByRole('tab', { name: 'Passwort', exact: true }).click();

			const email = page.locator('#auth-email');
			const password = page.locator('#auth-password');
			await expect(email).toBeVisible();

			// Both fields must skip native constraint validation (noValidate) so an
			// invalid email or short password reaches the custom, German ErrorBox
			// instead of a silently-swallowed submit or a browser-default tooltip.
			await expect(page.locator('form').filter({ has: email })).toHaveAttribute('novalidate', '');

			await email.fill('not-an-email');
			await password.fill('123');
			await password.press('Enter');

			await expect(page.locator('#auth-email-error')).toContainText(
				'Bitte gib eine gültige E-Mail-Adresse und dein Passwort ein.',
			);
		});

		test('sign-in keeps current-password and links to the registration page', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto(`/login?invite=${INVITE_TOKEN}&utm=x`);
			await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
			await expect(page.locator('#auth-password')).toHaveAttribute(
				'autocomplete',
				'current-password',
			);
			await expect(page.getByRole('button', { name: 'Konto erstellen' })).toHaveCount(0);
			await page.getByRole('link', { name: 'Konto erstellen', exact: true }).click();
			await expect(page).toHaveURL(/\/signup\?next=%2Finvite%2Ffixture-invite-token01$/);
			await expect(
				page.getByRole('heading', { name: 'Konto erstellen', exact: true, level: 1 }),
			).toBeVisible();
			await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
			await expect(page).toHaveURL(/\/login\?next=%2Finvite%2Ffixture-invite-token01$/);
		});

		test('a malformed invitation is explained on the sign-in page', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto('/login?invite=abc');
			await expect(
				page.getByText('Dieser Einladungslink ist unvollständig oder ungültig.'),
			).toBeVisible();
			await page.goto('/login?code=mte8pzat');
			await expect(page.getByText('Ein WG-Code')).toHaveCount(0);
		});

		test('the reset page without a recovery link lets visitors request a new one', async ({
			page,
		}) => {
			await page.goto('/auth/reset');
			await expect(page.getByText('Dieser Link ist ungültig oder abgelaufen.')).toBeVisible();
			await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
			await page.getByRole('button', { name: 'Link senden', exact: true }).click();
			await expect(page.getByText('Bitte gib eine gültige E-Mail-Adresse ein.')).toBeVisible();
		});

		test('registration validates locally and never sends invalid sign-ups', async ({ page }) => {
			let signUpRequests = 0;
			await page.route(
				(url) => url.pathname === '/api/auth/sign-up',
				async (route) => {
					signUpRequests += 1;
					await route.abort();
				},
			);
			await page.goto('/signup?action=create');
			const name = page.getByLabel('Dein Name');
			const email = page.getByLabel('E-Mail-Adresse');
			const password = page.getByLabel('Passwort', { exact: true });
			const confirmation = page.getByLabel('Passwort wiederholen');
			const submit = page.getByRole('button', { name: 'Konto erstellen', exact: true });
			await expect(password).toHaveAttribute('autocomplete', 'new-password');
			await expect(confirmation).toHaveAttribute('autocomplete', 'new-password');
			await expect(page.getByText('danach legst du deine neue WG an')).toBeVisible();

			await email.fill('nicht-gueltig');
			await password.fill('langes-passwort');
			await confirmation.fill('langes-passwort');
			await submit.click();
			await expect(page.locator('#signup-error')).toContainText('Namen');
			await expect(name).toHaveAttribute('aria-invalid', 'true');

			await name.fill('Mina');
			await submit.click();
			await expect(page.locator('#signup-error')).toContainText('gültige E-Mail-Adresse');
			await expect(email).toHaveAttribute('aria-invalid', 'true');

			await email.fill('neu@example.invalid');
			await password.fill('kurz');
			await confirmation.fill('kurz');
			await submit.click();
			await expect(page.locator('#signup-error')).toContainText('mindestens 8 Zeichen');
			await expect(password).toHaveAttribute('aria-invalid', 'true');

			await password.fill('langes-passwort');
			await confirmation.fill('anderes-passwort');
			await submit.click();
			await expect(page.locator('#signup-error')).toContainText('stimmen nicht überein');
			await expect(confirmation).toHaveAttribute('aria-invalid', 'true');
			expect(signUpRequests).toBe(0);
		});

		test('registration fits a 320px viewport without horizontal scroll', async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 780 });
			for (const scheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: scheme });
				await page.goto('/signup');
				await expect(
					page.getByRole('heading', { name: 'Konto erstellen', level: 1 }),
				).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
					320,
				);
			}
		});
	});
});

test.describe('entry accessibility', () => {
	test.describe('new WG form accessibility fixture', () => {
		skipUnlessDbDown();

		test('public start page offers registration next to sign-in for guests', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto(`/?invite=${INVITE_TOKEN}`);
			await expect(
				page.getByRole('link', { name: 'Konto erstellen', exact: true }),
			).toHaveAttribute('href', '/signup?next=%2Finvite%2Ffixture-invite-token01');
			// Account first: without an invitation the WG is created after sign-in, so no intent is carried.
			await page.goto('/');
			await expect(
				page.getByRole('link', { name: 'Konto erstellen', exact: true }),
			).toHaveAttribute('href', '/signup');
			await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toHaveAttribute(
				'href',
				'/login',
			);
		});

		test('public start page links the legal pages without an account', async ({ page }) => {
			// playwright.config.ts sets it for locally started servers only.
			const legalUrl = process.env.NEXT_PUBLIC_LEGAL_URL;
			test.skip(!legalUrl, 'A remote deployment chooses its own legal pages.');
			await page.goto('/');
			const legal = page.getByRole('navigation', { name: 'Rechtliches' });
			for (const [name, path] of [
				['Impressum', '/impressum'],
				['Datenschutz', '/datenschutz'],
				['AGB', '/agb'],
			] as const) {
				await expect(legal.getByRole('link', { name, exact: true })).toHaveAttribute(
					'href',
					`${legalUrl}${path}`,
				);
			}
		});

		test('moves focus between steps and keeps server errors form-level', async ({ page }) => {
			await mockNoWgs(page);
			await page.route('**/api/wg', async (route) => {
				if (route.request().method() === 'POST') {
					await route.fulfill({
						status: 500,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'server_error' }),
					});
					return;
				}
				await route.continue();
			});

			await page.goto('/login');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();

			const wgName = page.getByLabel('WG-Name');
			const creatorName = page.getByLabel('Dein Anzeigename');
			await expect(wgName).toBeFocused();
			await expect(wgName).toHaveAttribute('required', '');
			await expect(creatorName).toHaveAttribute('required', '');

			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();
			await expect(wgName).toHaveAttribute('aria-invalid', 'true');
			await expect(creatorName).toHaveAttribute('aria-invalid', 'false');

			await wgName.fill('Fixture WG');
			await creatorName.fill('Fixture User');
			await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();
			const formAlert = page.locator('#create-wg-form-error');
			await expect(formAlert).toContainText('WG konnte nicht erstellt werden');
			await expect(formAlert).toHaveAttribute('role', 'alert');
			await expect(wgName).toHaveAttribute('aria-invalid', 'false');
			await expect(creatorName).toHaveAttribute('aria-invalid', 'false');

			await page.getByRole('button', { name: 'Zurück', exact: true }).click();
			await page.getByRole('button', { name: 'Mit Einladung beitreten', exact: true }).click();
			const inviteLink = page.locator('#invite-link');
			await expect(inviteLink).toBeFocused();
			await expect(inviteLink).toHaveAttribute('required', '');

			// A bare share code is only the WG's address and cannot open an invitation.
			await inviteLink.fill(FIXTURE_WG.shareCode);
			await page.getByRole('button', { name: 'Einladung öffnen', exact: true }).click();
			await expect(inviteLink).toBeFocused();
			await expect(inviteLink).toHaveAttribute('aria-invalid', 'true');
			await expect(
				page.getByText('Das ist kein Einladungslink. Füge den ganzen Link ein.'),
			).toBeVisible();

			await inviteLink.fill(`http://localhost/invite/${INVITE_TOKEN}`);
			await page.getByRole('button', { name: 'Einladung öffnen', exact: true }).click();
			await expect(page).toHaveURL(`/invite/${INVITE_TOKEN}`);
			await expect(page.getByLabel('Dein Anzeigename')).toBeFocused();
			await expect(page.getByLabel('Dein Anzeigename')).toHaveAttribute('required', '');
			// The invitation names the WG before joining; the share code never appears.
			await expect(
				page.getByRole('heading', { name: 'Tritt der WG „Kastanienallee 12“ bei' }),
			).toBeVisible();
			await expect(page.getByText(FIXTURE_WG.shareCode)).toHaveCount(0);
		});
	});
});

test.describe('auth forms before hydration', () => {
	skipUnlessDbDown();

	// A tap on submit before the JavaScript has loaded submits the form natively. Without
	// method="post" that is a GET, which puts the password into the URL, the history and server logs.
	test.use({ javaScriptEnabled: false });

	test('a native sign-up submit keeps the password out of the URL', async ({ page }) => {
		await page.goto('/signup');
		await page.getByLabel('E-Mail-Adresse').fill('mina@example.invalid');
		const password = page.getByLabel('Passwort', { exact: true });
		await password.fill('native-submit-secret');
		await Promise.all([page.waitForURL('**/signup'), password.press('Enter')]);
		expect(page.url()).not.toContain('native-submit-secret');
		expect(page.url()).not.toContain('mina%40example.invalid');
	});

	test('a native reset request keeps the email address out of the URL', async ({ page }) => {
		await page.goto('/auth/reset');
		const email = page.getByLabel('E-Mail-Adresse');
		await email.fill('mina@example.invalid');
		await Promise.all([page.waitForURL('**/auth/reset'), email.press('Enter')]);
		expect(page.url()).not.toContain('mina%40example.invalid');
	});
});
