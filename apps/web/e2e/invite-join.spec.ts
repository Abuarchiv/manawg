// Invitation flow (fixture lane): a creator gets a personal link, the link opens the join page, joining lands in the WG.
// Why: the share code is only the WG's address; the link is the only way in.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, mockNoWgs, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('invitation link', () => {
	skipUnlessFixtures();

	test('the created WG offers a personal link; opening it and entering a name joins the WG', async ({
		page,
	}) => {
		await setupMember(page);
		await mockNoWgs(page);

		await page.goto('/login');
		await page.getByRole('button', { name: 'Neue WG erstellen', exact: true }).click();
		await page.getByLabel('WG-Name').fill('Fixture WG');
		await page.getByLabel('Dein Anzeigename').fill('Anna');
		await page.getByRole('button', { name: 'WG erstellen', exact: true }).click();

		const linkButton = page.getByRole('button', { name: 'Einladungslink kopieren' });
		await expect(linkButton).toContainText('/invite/', { timeout: 30_000 });
		await expect(page.getByText('Er gilt 7 Tage.')).toBeVisible();
		const link = (await linkButton.textContent())?.trim() ?? '';
		expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{22}$/);

		await page.goto(link);
		await expect(
			page.getByRole('heading', { name: 'Tritt der WG „Kastanienallee 12“ bei' }),
		).toBeVisible();
		await page.getByLabel('Dein Anzeigename').fill('Mira Neu');
		await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

		await expect(page).toHaveURL(new RegExp(`/wg/${FIXTURE_WG.shareCode}$`));
	});
});
