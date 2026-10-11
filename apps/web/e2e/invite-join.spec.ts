// Invitation flow (fixture lane): a creator gets a personal link, the link opens the join page, joining lands in the WG.
// Why: the share code is only the WG's address; the link is the only way in.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, mockNoWgs, setupMember } from './support/helpers';

test.describe('invitation link', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	test('the created WG offers a personal link; opening it and entering a name joins the WG', async ({
		page,
	}) => {
		await setupMember(page);
		await mockNoWgs(page);

		await page.goto('/neu');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await page.getByLabel('WG-Name').fill('Fixture WG');
		await page.getByLabel('Dein Anzeigename').fill('Anna');
		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

		const linkButton = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(linkButton).toContainText('/einladung/', { timeout: 30_000 });
		await expect(page.getByText('Er gilt 7 Tage.')).toBeVisible();
		const link = (await linkButton.textContent())?.trim() ?? '';
		expect(link).toMatch(/\/einladung\/[A-Za-z0-9_-]{22}$/);

		await page.goto(link);
		await expect(page.getByRole('heading', { name: 'Tritt der WG „sadf“ bei' })).toBeVisible();
		await page.getByLabel('Dein Anzeigename').fill('Mira Neu');
		await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
	});

	test('a profile from before accounts can be taken over from the invitation page', async ({
		page,
	}) => {
		await setupMember(page);
		await mockNoWgs(page);
		const token = 'aB3_-xYz09aB3_-xYz09kQ';
		await page.route(`**/api/wg/invites/${token}`, (route) =>
			route.fulfill({
				status: 200,
				json: {
					wg: { name: 'Altbau', shareCode: FIXTURE_WG.shareCode },
					unclaimed: [{ id: FIXTURE_WG.memberId, name: 'Anna' }],
				},
			}),
		);
		let claimUrl = '';
		await page.route('**/members/*/claim?**', (route) => {
			claimUrl = route.request().url();
			return route.fulfill({
				status: 200,
				json: { member: { id: FIXTURE_WG.memberId, name: 'Anna' } },
			});
		});

		await page.goto(`/einladung/${token}`);
		await expect(page.getByRole('heading', { name: 'Schon Mitglied?' })).toBeVisible();
		await page.getByRole('button', { name: 'Ich bin Anna' }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
		expect(claimUrl).toContain(`/members/${FIXTURE_WG.memberId}/claim?invite=${token}`);
	});
});
