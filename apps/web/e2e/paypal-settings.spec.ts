// PayPal settings: status errors are announced and retryable, and PayPal document security keeps
// the popup opener on every page that loads the SDK.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.describe('paypal settings error association', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('PayPal status failure is announced and can be retried from the keyboard', async ({
		page,
	}) => {
		await setupMember(page);

		let retryRequested = false;
		let statusGets = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				statusGets += 1;
				if (!retryRequested) {
					return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
				}
				return route.fulfill({ json: { available: true, connected: false } });
			}
			// Retrying without a started onboarding has nothing to complete.
			return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		const errorAlert = page.getByRole('alert').filter({
			hasText: 'PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.',
		});
		await expect(errorAlert).toBeVisible({ timeout: 30_000 });
		expect(statusGets).toBeGreaterThan(0);
		await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();

		const retry = page.getByRole('button', { name: 'Verbindung prüfen', exact: true });
		await expect(retry).toBeVisible();
		const getsBeforeRetry = statusGets;
		await retry.focus();
		retryRequested = true;
		await page.keyboard.press('Enter');

		await expect(errorAlert).toBeHidden();
		await expect(page.getByRole('button', { name: 'PayPal verbinden', exact: true })).toBeEnabled();
		await expect.poll(() => statusGets).toBeGreaterThan(getsBeforeRetry);
	});
});

test.describe('paypal settings load error', () => {
	// page.route provider doubles must not be bypassed by the built app's service worker.
	test.use({ serviceWorkers: 'block' });
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	for (const width of [320, 360]) {
		for (const theme of ['Hell', 'Dunkel'] as const) {
			if (width !== 320) continue;
			test(`${width}px ${theme}: unknown status keeps explicit connect available and can be retried`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height: 780 });
				await setupMember(page);

				let retryRequested = false;
				let statusGets = 0;
				const startBodies: unknown[] = [];
				const completeBodies: unknown[] = [];
				await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
					if (route.request().method() === 'GET') {
						statusGets += 1;
						if (!retryRequested) {
							return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
						}
						return route.fulfill({ json: { available: true, connected: false } });
					}
					const body = route.request().postDataJSON() as { action?: string };
					if (body.action === 'start') startBodies.push(body);
					if (body.action === 'complete') {
						completeBodies.push(body);
						return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
					}
					return route.fulfill({ status: 400, json: { error: 'unexpected_action' } });
				});

				await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
				const themeButton = page.getByRole('button', { name: theme, exact: true });
				await expect(themeButton).toBeVisible({ timeout: 30_000 });
				const errorAlert = page.getByRole('alert').filter({
					hasText: 'PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.',
				});
				await expect(errorAlert).toBeVisible();
				expect(statusGets).toBeGreaterThan(0);
				await expect(page.getByRole('textbox', { name: /merchant.?id/i })).toHaveCount(0);
				await expect(
					page.getByRole('button', { name: 'PayPal verbinden', exact: true }),
				).toBeEnabled();

				await themeButton.click();
				if (theme === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
				else await expect(page.locator('html')).not.toHaveClass(/dark/);
				const layout = await page.evaluate(() => ({
					viewport: document.documentElement.clientWidth,
					content: document.documentElement.scrollWidth,
				}));
				expect(layout.content).toBeLessThanOrEqual(layout.viewport);
				expect(startBodies).toEqual([]);

				const retry = page.getByRole('button', { name: 'Verbindung prüfen', exact: true });
				await expect(retry).toBeVisible();
				const getsBeforeRetry = statusGets;
				await retry.focus();
				retryRequested = true;
				await page.keyboard.press('Enter');

				await expect(errorAlert).toBeHidden();
				await expect.poll(() => completeBodies).toEqual([{ action: 'complete' }]);
				// Without a started onboarding there is nothing to expire: stay quietly unconnected.
				await expect(
					page.getByText('Die PayPal-Verbindung ist abgelaufen. Bitte starte sie erneut.'),
				).toHaveCount(0);
				await expect(
					page.getByRole('button', { name: 'PayPal verbinden', exact: true }),
				).toBeEnabled();
				await expect.poll(() => statusGets).toBeGreaterThan(getsBeforeRetry);
				expect(startBodies).toEqual([]);
			});
		}
	}

	test('failed status retry preserves the status error without attempting cookie completion', async ({
		page,
	}) => {
		await setupMember(page);
		const posts: unknown[] = [];
		let gets = 0;
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/paypal/connect`, async (route) => {
			if (route.request().method() === 'GET') {
				gets += 1;
				return route.fulfill({ status: 503, json: { error: 'temporary_failure' } });
			}
			posts.push(route.request().postDataJSON());
			return route.fulfill({ status: 409, json: { error: 'paypal_connection_expired' } });
		});
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
		await expect.poll(() => gets).toBeGreaterThan(0);
		const before = gets;
		await page.getByRole('button', { name: 'Verbindung prüfen', exact: true }).click();
		await expect.poll(() => gets).toBeGreaterThan(before);
		await expect(
			page.getByText('PayPal-Verbindung konnte nicht geprüft werden. Bitte versuche es erneut.'),
		).toBeVisible();
		expect(posts).toEqual([]);
		await expect(
			page.getByText('Die PayPal-Verbindung ist abgelaufen. Bitte starte sie erneut.'),
		).toHaveCount(0);
	});
});

test.describe('paypal document security', () => {
	test.skip(
		!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ||
			!process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		'requires the PayPal SDK public configuration used by the application',
	);

	function directive(csp: string, name: string): string | undefined {
		return csp
			.split(';')
			.map((item) => item.trim())
			.find((item) => item.startsWith(`${name} `))
			?.slice(name.length)
			.trim();
	}

	for (const path of ['/', '/neu']) {
		test(`PayPal document security works from ${path} and retains the popup opener`, async ({
			page,
		}) => {
			await page.route('https://paypal.test/**', (route) =>
				route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: '<title>PayPal popup probe</title>',
				}),
			);

			const response = await page.goto(path);
			if (!response) throw new Error(`No document response for ${path}`);
			const headers = response.headers();
			expect(headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');

			const csp = headers['content-security-policy'] ?? '';
			expect(csp).toBeTruthy();
			const scriptSrc = directive(csp, 'script-src') ?? '';
			const connectSrc = directive(csp, 'connect-src') ?? '';
			const frameSrc = directive(csp, 'frame-src') ?? '';
			const policyNonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1];
			expect(policyNonce).toBeTruthy();
			expect(frameSrc).toContain('https://www.paypal.com');
			expect(frameSrc).toContain('https://www.sandbox.paypal.com');
			expect(connectSrc).toContain('https://www.paypal.com');
			expect(connectSrc).toContain('https://www.sandbox.paypal.com');

			const documentNonce = await page.evaluate(
				() => document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce,
			);
			expect(documentNonce).toBe(policyNonce);

			await page.evaluate(() => {
				const button = document.createElement('button');
				button.type = 'button';
				button.id = 'paypal-popup-probe';
				button.textContent = 'Open PayPal popup';
				button.style.position = 'fixed';
				button.style.top = '16px';
				button.style.right = '16px';
				button.style.zIndex = '2147483647';
				button.addEventListener('click', () =>
					window.open('https://paypal.test/checkout', 'paypal-checkout'),
				);
				document.body.append(button);
			});
			const popupPromise = page.waitForEvent('popup');
			await page.locator('#paypal-popup-probe').click();
			const popup = await popupPromise;
			await popup.waitForLoadState('domcontentloaded');
			expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
		});
	}
});
