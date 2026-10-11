// Sign-in / create-or-join entry flow (fixture lane): validation, tabs, code login, account switch.
// Live Supabase auth is covered by supabase-auth-live and social-login-live.

import { expect, test } from '@playwright/test';

import { mockNoWgs } from './support/helpers';

test.describe('auth e-mail code flow', () => {
	test.describe('e-mail code authentication fixture', () => {
		test.skip(process.env.AUTH_UI_E2E !== 'true', 'Requires the isolated fake Supabase fixture.');

		test('signs in with a mailed code and prefills the account name', async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 780 });
			const user = {
				id: '00000000-0000-4000-8000-000000000001',
				aud: 'authenticated',
				role: 'authenticated',
				email: 'mina@example.invalid',
				app_metadata: {},
				user_metadata: { full_name: 'Mina Muster' },
				created_at: '2026-01-01T00:00:00Z',
			};
			const verifyBodies: unknown[] = [];
			let signedIn = false;
			await page.route('**/auth/v1/**', async (route) => {
				const { pathname } = new URL(route.request().url());
				const json = (status: number, body: unknown) =>
					route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
				if (pathname.endsWith('/otp')) return json(200, {});
				if (pathname.endsWith('/verify')) {
					verifyBodies.push(route.request().postDataJSON());
					if (verifyBodies.length === 1) {
						return json(403, { code: 'otp_expired', message: 'Token has expired or is invalid' });
					}
					signedIn = true;
					return json(200, {
						access_token: 'fixture-access',
						token_type: 'bearer',
						expires_in: 3600,
						refresh_token: 'fixture-refresh',
						user,
					});
				}
				if (pathname.endsWith('/user')) return json(200, user);
				return json(404, {});
			});
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
			expect(verifyBodies.at(-1)).toMatchObject({
				email: 'mina@example.invalid',
				token: '12345678',
				type: 'email',
			});
			await expect(page.getByLabel('Dein Anzeigename')).toHaveValue('Mina Muster');
		});
	});
});

test.describe('auth tab responsive', () => {
	test.describe('password tab at large text', () => {
		test.skip(
			process.env.AUTH_UI_E2E !== 'true' || process.env.AUTH_TAB_RESPONSIVE_E2E !== 'true',
			'Requires the isolated fake Supabase server and 32px root-font fixture.',
		);

		for (const scheme of ['light', 'dark'] as const) {
			test(`keeps the password tab label intact at 320px in ${scheme} mode`, async ({ page }) => {
				await page.setViewportSize({ width: 320, height: 780 });
				await page.emulateMedia({ colorScheme: scheme });
				await page.addInitScript((theme) => localStorage.setItem('manawg-theme', theme), scheme);
				await page.route('**/auth/v1/**', (route) =>
					route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
				);
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

test.describe('start credentials auth validation', () => {
	test.describe('credentials auth form validation fixture', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the database-down fixture server.',
		);

		test('shows the custom error box instead of native browser validation', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: '{"error":"auth_required"}',
				}),
			);
			await page.goto('/neu');
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
			await page.goto('/neu?code=mte8pzat&utm=x');
			await page.getByRole('tab', { name: 'Passwort', exact: true }).click();
			await expect(page.locator('#auth-password')).toHaveAttribute(
				'autocomplete',
				'current-password',
			);
			await expect(page.getByRole('button', { name: 'Konto erstellen' })).toHaveCount(0);
			await page.getByRole('link', { name: 'Konto erstellen', exact: true }).click();
			await expect(page).toHaveURL(/\/registrieren\?code=MTE8PZAT$/);
			await expect(
				page.getByRole('heading', { name: 'Konto erstellen', exact: true, level: 1 }),
			).toBeVisible();
			await expect(page.getByText('um mit deinem WG-Code beizutreten')).toBeVisible();
			await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
			await expect(page).toHaveURL(/\/neu\?code=MTE8PZAT$/);
		});

		test('a malformed invitation code is explained on the sign-in page', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto('/neu?code=abc');
			await expect(
				page.getByText('Dieser Einladungslink ist unvollständig oder ungültig.'),
			).toBeVisible();
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
				(url) => url.pathname === '/auth/v1/signup',
				async (route) => {
					signUpRequests += 1;
					await route.abort();
				},
			);
			await page.goto('/registrieren?action=create');
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

		test('registration shows a neutral inbox state with a throttled resend', async ({ page }) => {
			test.skip(process.env.AUTH_UI_E2E !== 'true', 'Requires the isolated fake Supabase fixture.');
			let resendRequests = 0;
			let signUpBody: unknown;
			await page.route('**/auth/v1/**', async (route) => {
				const { pathname } = new URL(route.request().url());
				if (pathname.endsWith('/signup')) {
					signUpBody = route.request().postDataJSON();
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ id: 'fixture-user', identities: [] }),
					});
					return;
				}
				if (pathname.endsWith('/resend')) {
					resendRequests += 1;
					await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
					return;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ external: {} }),
				});
			});
			await page.goto('/registrieren');
			await page.getByLabel('Dein Name').fill('Mina');
			await page.getByLabel('E-Mail-Adresse').fill('Neu@Example.invalid');
			await page.getByLabel('Passwort', { exact: true }).fill('langes-passwort');
			await page.getByLabel('Passwort wiederholen').fill('langes-passwort');
			await page.getByRole('button', { name: 'Konto erstellen', exact: true }).click();

			await expect(page.getByText('Prüfe dein Postfach')).toBeVisible();
			expect(signUpBody).toMatchObject({ data: { full_name: 'Mina' } });
			await expect(page.getByText('neu@example.invalid')).toBeVisible();
			await expect(page.getByRole('button', { name: /Erneut senden in \d+ s/ })).toBeDisabled();
			expect(resendRequests).toBe(0);
			await page.getByRole('button', { name: 'Andere E-Mail-Adresse verwenden' }).click();
			await expect(page.getByLabel('E-Mail-Adresse')).toBeVisible();
		});

		test('registration fits a 320px viewport without horizontal scroll', async ({ page }) => {
			await page.setViewportSize({ width: 320, height: 780 });
			for (const scheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: scheme });
				await page.goto('/registrieren');
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
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the database-down fixture server.',
		);

		test('public start page offers registration next to sign-in for guests', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto('/?code=mte8pzat');
			await expect(
				page.getByRole('link', { name: 'Konto erstellen', exact: true }),
			).toHaveAttribute('href', '/registrieren?code=MTE8PZAT');
			// Account first: without an invitation the WG is created after sign-in, so no intent is carried.
			await page.goto('/');
			await expect(
				page.getByRole('link', { name: 'Konto erstellen', exact: true }),
			).toHaveAttribute('href', '/registrieren');
			await expect(page.getByRole('link', { name: 'WG erstellen', exact: true })).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toHaveAttribute(
				'href',
				'/neu',
			);
		});

		test('public start page links the legal pages without an account', async ({ page }) => {
			await page.goto('/');
			const legal = page.getByRole('navigation', { name: 'Rechtliches' });
			for (const [name, href] of [
				['Impressum', 'https://manawg.com/impressum'],
				['Datenschutz', 'https://manawg.com/datenschutz'],
				['AGB', 'https://manawg.com/agb'],
			] as const) {
				await expect(legal.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
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

			await page.goto('/neu');
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
			await page.getByRole('button', { name: 'Per Code beitreten', exact: true }).click();
			const joinCode = page.locator('#join-code');
			await expect(joinCode).toBeFocused();
			await expect(joinCode).toHaveAttribute('required', '');

			await joinCode.fill('MTE8PZAT');
			await page.getByRole('button', { name: 'WG-Code prüfen', exact: true }).click();
			await expect(page.getByLabel('Dein Anzeigename')).toBeFocused();
			await expect(page.getByLabel('Dein Anzeigename')).toHaveAttribute('required', '');

			// The real WG name can't be fetched before joining (privacy-by-design), so the
			// confirmation copy must reference the actual code rather than a fabricated name.
			await expect(page.getByText('Du trittst', { exact: false })).toContainText('MTE8PZAT');
			await expect(page.getByText('WG-Einladung', { exact: false })).toHaveCount(0);
		});
	});
});

test.describe('entry account switch', () => {
	test.describe('Neu account switch state reset', () => {
		test.skip(
			!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
			'Requires the configured Supabase browser client.',
		);

		test('does not restore the previous account draft after switching accounts', async ({
			page,
		}) => {
			await mockNoWgs(page);
			await page.route('**/auth/v1/logout', (route) => route.fulfill({ status: 204, body: '' }));

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
