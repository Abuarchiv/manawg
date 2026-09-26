import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

for (const width of [320, 360]) {
	for (const theme of ['Hell', 'Dunkel'] as const) {
		test(`${width}px ${theme}: PayPal load failure cannot clear the saved Merchant-ID`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 780 });
			await setupMember(page);

			let retryRequested = false;
			let failedLoads = 0;
			const memberRequests: string[] = [];
			const patchBodies: unknown[] = [];
			page.on('request', (request) => {
				if (request.url().includes('/api/wg/')) {
					memberRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
				}
			});
			await page.route(
				`**/api/wg/${FIXTURE_WG.shareCode}/members/${FIXTURE_WG.memberId}`,
				async (route) => {
					const request = route.request();
					if (request.method() === 'GET') {
						if (!retryRequested) {
							failedLoads += 1;
							await route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
							return;
						}
						await route.fulfill({
							status: 200,
							json: { member: { paypalMerchantId: 'existing-merchant-id' } },
						});
						return;
					}

					if (request.method() === 'PATCH') {
						patchBodies.push(request.postDataJSON());
						await route.fulfill({
							status: 200,
							json: { member: { paypalMerchantId: 'existing-merchant-id' } },
						});
						return;
					}

					await route.continue();
				},
			);

			await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);
			const themeButton = page.getByRole('button', { name: theme, exact: true });
			await expect(themeButton).toBeVisible({ timeout: 30_000 });
			const merchantId = page.getByRole('textbox', { name: 'PayPal Merchant-ID' });
			const save = page.getByRole('button', { name: 'Speichern', exact: true });
			const loadAlert = page
				.getByRole('alert')
				.filter({ hasText: 'PayPal-Einstellung konnte nicht geladen werden.' });
			await expect(loadAlert).toBeVisible();
			expect(failedLoads, `PayPal member requests: ${memberRequests.join(', ')}`).toBeGreaterThan(
				0,
			);

			await themeButton.click();
			if (theme === 'Dunkel') await expect(page.locator('html')).toHaveClass(/dark/);
			else await expect(page.locator('html')).not.toHaveClass(/dark/);

			await expect(merchantId).toBeDisabled();
			await expect(save).toBeDisabled();
			expect(patchBodies).toEqual([]);
			const layout = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				content: document.documentElement.scrollWidth,
			}));
			expect(layout.content).toBeLessThanOrEqual(layout.viewport);

			const retry = page.getByRole('button', { name: 'Erneut versuchen', exact: true });
			await expect(retry).toBeVisible();
			await retry.focus();
			retryRequested = true;
			await page.keyboard.press('Enter');

			await expect(merchantId).toHaveValue('existing-merchant-id');
			await expect(loadAlert).toBeHidden();
			await expect(save).toBeEnabled();
			await save.focus();
			await page.keyboard.press('Enter');

			await expect.poll(() => patchBodies.length).toBe(1);
			expect(patchBodies).toEqual([{ paypalMerchantId: 'existing-merchant-id' }]);
			await expect(
				page.getByRole('alert').filter({ hasText: 'PayPal Merchant-ID gespeichert.' }),
			).toBeVisible();
		});
	}
}
