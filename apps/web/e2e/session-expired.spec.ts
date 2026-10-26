// Session expiry banner on WG screens.
// Why: an expired session must show one explanation and a way back to the same page.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember, skipUnlessDbDown } from './support/helpers';

test.describe('session expired banner', () => {
	skipUnlessDbDown();

	test('an auth_required answer offers signing in again and returns to the page', async ({
		page,
	}) => {
		await setupMember(page);
		await page.route('**/api/wg/*/members*', (route) =>
			route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'auth_required', code: 'auth_required' }),
			}),
		);

		const path = `/wg/${FIXTURE_WG.shareCode}/einkauf?x=1`;
		await page.goto(path);

		const banner = page.locator('[data-session-banner]');
		await expect(banner).toContainText('Deine Sitzung ist abgelaufen');
		await expect(banner.getByRole('link', { name: 'Neu anmelden' })).toHaveAttribute(
			'href',
			`/neu?next=${encodeURIComponent(path)}`,
		);
	});
});
