// Changing the own display name in the settings profile.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, navigateToFeature, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('member rename', () => {
	skipUnlessFixtures();

	test('sends the trimmed name with the expected old name and names a taken name', async ({
		page,
	}) => {
		let status = 409;
		let sent: { name?: string; expectedName?: string } = {};
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
				if (route.request().method() !== 'PATCH') return route.fallback();
				sent = route.request().postDataJSON();
				return status === 409
					? route.fulfill({ status, json: { error: 'name_taken' } })
					: route.fulfill({
							json: { member: { id: FIXTURE_WG.memberId, name: sent.name, active: true } },
						});
			},
		);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einstellungen`);

		const field = page.getByLabel('Dein Name', { exact: true });
		const save = page
			.locator('form')
			.filter({ has: field })
			.getByRole('button', { name: 'Speichern', exact: true });
		await expect(field).toHaveValue(FIXTURE_WG.memberName);
		await expect(save).toBeDisabled();
		await field.fill('  Mara ');
		await save.click();
		await expect(page.getByText('Der Name ist in dieser WG schon vergeben.')).toBeVisible();
		expect(sent).toEqual({ name: 'Mara', expectedName: FIXTURE_WG.memberName });

		status = 200;
		await save.click();
		await expect(page.getByText('Name gespeichert.')).toBeVisible();
	});
});
