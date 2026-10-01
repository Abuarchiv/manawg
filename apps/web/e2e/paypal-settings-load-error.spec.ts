import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

// page.route provider doubles must not be bypassed by the built app's service worker.
test.use({ serviceWorkers: 'block' });
test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

for (const width of [320, 360]) {
	for (const theme of ['Hell', 'Dunkel'] as const) {
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
