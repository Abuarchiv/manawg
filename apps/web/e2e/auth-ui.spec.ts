// E-mail code login, password tab and registration inbox state against the configured Supabase
// browser client. Live Supabase auth is covered by supabase-auth-live and social-login-live.

import { expect, type Route, test } from '@playwright/test';

import { mockNoWgs, skipUnlessDbDown } from './support/helpers';

// These specs answer the Supabase /auth/v1 and /api/auth requests through page routes.
// They run on the second fixture server, built with a fake Supabase project
// (see playwright.config.ts).

test.describe('auth e-mail code flow', () => {
	test.describe('e-mail code authentication fixture', () => {
		skipUnlessDbDown();

		test('signs in with a mailed code and prefills the account name', async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 780 });
			const user = { email: 'mina@example.invalid' };
			const verifyBodies: unknown[] = [];
			let signedIn = false;
			const json = (
				route: Route,
				status: number,
				body: unknown,
				headers: Record<string, string> = {},
			) =>
				route.fulfill({
					status,
					contentType: 'application/json',
					headers,
					body: JSON.stringify(body),
				});
			await page.route('**/api/auth/code-request', (route) => json(route, 200, { ok: true }));
			await page.route('**/api/auth/code-verify', (route) => {
				verifyBodies.push(route.request().postDataJSON());
				if (verifyBodies.length === 1) {
					return json(route, 403, { error: 'otp_expired', code: 'otp_expired' });
				}
				signedIn = true;
				// The real route sets the HttpOnly session cookies and this hint.
				return json(
					route,
					200,
					{ sessionEstablished: true },
					{ 'set-cookie': 'manawg_signed_in=1; Path=/' },
				);
			});
			await page.route('**/api/auth/identities', (route) =>
				json(route, 200, {
					email: user.email,
					hasPassword: false,
					hasGoogle: false,
					name: 'Mina Muster',
				}),
			);
			await page.route('**/api/wg/mine', (route) =>
				signedIn
					? route.fulfill({ status: 200, contentType: 'application/json', body: '{"wgs":[]}' })
					: route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);

			await page.goto('/neu');
			await expect(page.getByRole('tab', { name: 'Code per E-Mail' })).toHaveAttribute(
				'aria-selected',
				'true',
			);
			await page.getByLabel('E-Mail-Adresse').fill('Mina@Example.invalid');
			await page.getByRole('button', { name: 'Code per E-Mail senden' }).click();

			const code = page.getByLabel('8-stelliger Code');
			await expect(code).toBeFocused();
			await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
			await expect(
				page.getByRole('button', { name: /Code erneut senden in \d+ s/ }),
			).toBeDisabled();

			await code.fill('123');
			await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
			await expect(code).toHaveAttribute('aria-invalid', 'true');
			expect(verifyBodies).toHaveLength(0);

			await code.fill('12345678');
			await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
			await expect(
				page.getByText('Code falsch oder abgelaufen. Fordere einen neuen an.'),
			).toBeVisible();

			// The second attempt is accepted and lands on the start page with the account name known.
			await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			expect(verifyBodies.at(-1)).toEqual({
				email: 'mina@example.invalid',
				token: '12345678',
			});
			await expect(page.getByLabel('Dein Anzeigename')).toHaveValue('Mina Muster');
		});
	});
});

test.describe('auth tab responsive', () => {
	test.describe('password tab at large text', () => {
		skipUnlessDbDown();

		for (const scheme of ['light', 'dark'] as const) {
			test(`keeps the password tab label intact at 320px in ${scheme} mode`, async ({ page }) => {
				await page.setViewportSize({ width: 320, height: 780 });
				await page.emulateMedia({ colorScheme: scheme });
				await page.addInitScript((theme) => localStorage.setItem('manawg-theme', theme), scheme);
				await page.route('**/__auth-test-root32.css', (route) =>
					route.fulfill({
						status: 200,
						contentType: 'text/css',
						body: 'html { font-size: 32px !important; }',
					}),
				);

				await page.goto('/neu');
				await page.evaluate(
					() =>
						new Promise<void>((resolve, reject) => {
							const stylesheet = document.createElement('link');
							stylesheet.rel = 'stylesheet';
							stylesheet.href = '/__auth-test-root32.css';
							stylesheet.onload = () => resolve();
							stylesheet.onerror = () => reject(new Error('root font fixture failed to load'));
							document.head.append(stylesheet);
						}),
				);
				await page.waitForFunction(
					({ dark }) =>
						getComputedStyle(document.documentElement).fontSize === '32px' &&
						document.documentElement.classList.contains('dark') === dark,
					{ dark: scheme === 'dark' },
				);

				const passwordTab = page.getByRole('tab', { name: 'Passwort', exact: true });
				await expect(passwordTab).toBeVisible();
				const geometry = await passwordTab.evaluate((tab) => {
					const rect = tab.getBoundingClientRect();
					const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
					let wordRects: Array<{ right: number }> = [];
					while (walker.nextNode()) {
						const text = walker.currentNode.nodeValue ?? '';
						const start = text.indexOf('Passwort');
						if (start < 0) continue;
						const range = document.createRange();
						range.setStart(walker.currentNode, start);
						range.setEnd(walker.currentNode, start + 'Passwort'.length);
						wordRects = Array.from(range.getClientRects(), (line) => ({ right: line.right }));
						break;
					}
					return {
						rootFontSize: getComputedStyle(document.documentElement).fontSize,
						documentWidth: document.documentElement.scrollWidth,
						tabRight: rect.right,
						wordRects,
					};
				});

				expect(geometry.rootFontSize).toBe('32px');
				expect(geometry.documentWidth).toBe(320);
				expect(geometry.wordRects).toHaveLength(1);
				expect(geometry.wordRects[0]?.right).toBeLessThanOrEqual(geometry.tabRight);
			});
		}
	});
});

test.describe('auth registration inbox', () => {
	skipUnlessDbDown();

	test('registration shows a neutral inbox state with a throttled resend', async ({ page }) => {
		let resendRequests = 0;
		let signUpBody: unknown;
		await page.route('**/api/auth/sign-up', async (route) => {
			signUpBody = route.request().postDataJSON();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ sessionEstablished: false }),
			});
		});
		await page.route('**/api/auth/resend', async (route) => {
			resendRequests += 1;
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
		});
		await page.goto('/registrieren');
		await page.getByLabel('Dein Name').fill('Mina');
		await page.getByLabel('E-Mail-Adresse').fill('Neu@Example.invalid');
		await page.getByLabel('Passwort', { exact: true }).fill('langes-passwort');
		await page.getByLabel('Passwort wiederholen').fill('langes-passwort');
		await page.getByRole('button', { name: 'Konto erstellen', exact: true }).click();

		await expect(page.getByText('Prüfe dein Postfach')).toBeVisible();
		expect(signUpBody).toMatchObject({ name: 'Mina', email: 'neu@example.invalid' });
		await expect(page.getByText('neu@example.invalid')).toBeVisible();
		await expect(page.getByRole('button', { name: /Erneut senden in \d+ s/ })).toBeDisabled();
		expect(resendRequests).toBe(0);
		await page.getByRole('button', { name: 'Andere E-Mail-Adresse verwenden' }).click();
		await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
	});
});

test.describe('entry account switch', () => {
	skipUnlessDbDown();

	test.describe('Neu account switch state reset', () => {
		test('does not restore the previous account draft after switching accounts', async ({
			page,
		}) => {
			await mockNoWgs(page);
			await page.route('**/api/auth/sign-out', (route) =>
				route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
			);

			await page.goto('/neu');
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await page.getByLabel('WG-Name').fill('Altes Konto');
			await page.getByLabel('Dein Anzeigename').fill('Altes Profil');
			await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

			await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
			await page.reload();
			await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
			await expect(page.getByLabel('WG-Name')).toHaveValue('');
			await expect(page.getByLabel('Dein Anzeigename')).toHaveValue('');
		});
	});
});

test.describe('auth sign-out intent', () => {
	skipUnlessDbDown();

	test('restores create intent from the URL after signing out', async ({ page }) => {
		await mockNoWgs(page);

		await page.goto('/neu?action=create');
		await page.getByRole('button', { name: 'Mit anderem Konto anmelden', exact: true }).click();

		await expect(page.getByText('Melde dich an, danach erstellst du deine neue WG.')).toBeVisible();
	});

	test('forwards an invitation link on the start page to the invitation page', async ({ page }) => {
		await mockNoWgs(page);

		await page.goto('/neu?invite=fixture-invite-token01');

		await expect(page).toHaveURL('/einladung/fixture-invite-token01');
	});
});
