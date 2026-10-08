// Sign-in / create-or-join entry flow (fixture lane): validation, tabs, phone layout, account switch.
// Live Supabase auth is covered by supabase-auth-live and social-login-live.

import { expect, test } from '@playwright/test';

import { mockNoWgs } from './support/helpers';

test.describe('auth phone flow', () => {
	test.describe('phone authentication fixture', () => {
		test.skip(process.env.AUTH_UI_E2E !== 'true', 'Requires the isolated fake Supabase fixture.');

		test('keeps the SMS tab selected and reports incomplete codes on the code field', async ({
			page,
		}) => {
			await page.setViewportSize({ width: 320, height: 780 });
			await page.route('**/auth/v1/**', async (route) => {
				const { pathname } = new URL(route.request().url());
				if (pathname.endsWith('/settings')) {
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ external: { phone: true } }),
					});
					return;
				}
				if (pathname.endsWith('/otp')) {
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({ message_id: 'fixture-message' }),
					});
					return;
				}
				await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
			});

			await page.goto('/neu');
			const phoneTab = page.getByRole('tab', { name: 'Telefon / SMS' });
			await phoneTab.click();

			const phone = page.getByLabel('Telefonnummer');
			await phone.fill('+491701234567');
			await page.getByRole('button', { name: 'SMS-Code anfordern' }).click();

			const otp = page.getByLabel('6-stelliger SMS-Code');
			await expect(otp).toBeVisible();
			await expect(phoneTab).toHaveAttribute('aria-selected', 'true');

			await otp.fill('123');
			await page.getByRole('button', { name: 'Code bestätigen' }).click();
			await expect(
				page.getByText('Gib einen sechsstelligen SMS-Code ein.', { exact: true }),
			).toBeVisible();
			await expect(otp).toHaveAttribute('aria-invalid', 'true');
			await expect(phone).not.toHaveAttribute('aria-invalid', 'true');
		});
	});
});

test.describe('auth tab responsive', () => {
	test.describe('phone authentication tab at large text', () => {
		test.skip(
			process.env.AUTH_UI_E2E !== 'true' || process.env.AUTH_TAB_RESPONSIVE_E2E !== 'true',
			'Requires the isolated fake Supabase server and 32px root-font fixture.',
		);

		for (const scheme of ['light', 'dark'] as const) {
			test(`keeps the phone tab label intact at 320px in ${scheme} mode`, async ({ page }) => {
				await page.setViewportSize({ width: 320, height: 780 });
				await page.emulateMedia({ colorScheme: scheme });
				await page.addInitScript((theme) => localStorage.setItem('manawg-theme', theme), scheme);
				await page.route('**/auth/v1/**', (route) => {
					if (new URL(route.request().url()).pathname.endsWith('/settings')) {
						return route.fulfill({
							status: 200,
							contentType: 'application/json',
							body: JSON.stringify({ external: { phone: true } }),
						});
					}
					return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
				});
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

				const phoneTab = page.getByRole('tab', { name: 'Telefon / SMS', exact: true });
				await expect(phoneTab).toBeVisible();
				const geometry = await phoneTab.evaluate((tab) => {
					const rect = tab.getBoundingClientRect();
					const walker = document.createTreeWalker(tab, NodeFilter.SHOW_TEXT);
					let telefonRects: Array<{ right: number }> = [];
					while (walker.nextNode()) {
						const text = walker.currentNode.nodeValue ?? '';
						const start = text.indexOf('Telefon');
						if (start < 0) continue;
						const range = document.createRange();
						range.setStart(walker.currentNode, start);
						range.setEnd(walker.currentNode, start + 'Telefon'.length);
						telefonRects = Array.from(range.getClientRects(), (line) => ({ right: line.right }));
						break;
					}
					return {
						rootFontSize: getComputedStyle(document.documentElement).fontSize,
						documentWidth: document.documentElement.scrollWidth,
						tabRight: rect.right,
						telefonRects,
					};
				});

				expect(geometry.rootFontSize).toBe('32px');
				expect(geometry.documentWidth).toBe(320);
				expect(geometry.telefonRects).toHaveLength(1);
				expect(geometry.telefonRects[0]?.right).toBeLessThanOrEqual(geometry.tabRight);
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

		test('password field switches to new-password only for "Konto erstellen"', async ({ page }) => {
			await page.route('**/api/wg/mine', (route) =>
				route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
			);
			await page.goto('/neu');
			const password = page.locator('#auth-password');
			await expect(password).toHaveAttribute('autocomplete', 'current-password');
			await page.getByRole('button', { name: 'Konto erstellen' }).focus();
			await expect(password).toHaveAttribute('autocomplete', 'new-password');
			await password.focus();
			await expect(password).toHaveAttribute('autocomplete', 'current-password');
		});
	});
});

test.describe('entry accessibility', () => {
	test.describe('new WG form accessibility fixture', () => {
		test.skip(
			process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
			'Requires the database-down fixture server.',
		);

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
