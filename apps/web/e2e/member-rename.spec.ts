// Changing the own display name in the settings profile.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember } from './_helpers';

test.describe('member rename', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('sends the trimmed name and names a taken name', async ({ page }) => {
		let status = 409;
		let sentName: string | undefined;
		await setupMember(page);
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/members`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						json: {
							members: [{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, active: true }],
							viewerIsAdmin: false,
						},
					})
				: route.fallback(),
		);
		await page.route(
			`**/api/wg/${FIXTURE_WG.shareCode}/members/${FIXTURE_WG.memberId}`,
			(route) => {
				if (route.request().method() !== 'PUT') return route.fallback();
				sentName = route.request().postDataJSON().name;
				return status === 409
					? route.fulfill({ status, json: { error: 'name_taken' } })
					: route.fulfill({ json: { member: { id: FIXTURE_WG.memberId, name: sentName } } });
			},
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);

		const field = page.getByLabel('Dein Name in der WG');
		const save = page.getByRole('button', { name: 'Name ändern' });
		await expect(field).toHaveValue(FIXTURE_WG.memberName);
		await expect(save).toBeDisabled();
		await field.fill('  Mara ');
		await save.click();
		await expect(page.getByText('Dieser Name ist in der WG schon vergeben.')).toBeVisible();
		expect(sentName).toBe('Mara');

		status = 200;
		await Promise.all([page.waitForEvent('load'), save.click()]);
		// The page reloads so that every screen shows the new name.
		expect(sentName).toBe('Mara');
	});
});
