// Invitation flow (fixture lane): a creator gets a personal link, the link opens the join page, joining lands in the WG.
// Why: the share code is only the WG's address; the link is the only way in.

import { expect, type Page, test } from '@playwright/test';
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

	test.describe('name errors on the join page', () => {
		const TOKEN = 'fixture-invite-token01';

		async function openJoinPage(page: Page): Promise<void> {
			await setupMember(page);
			await mockNoWgs(page);
			await page.route(`**/api/wg/invites/${TOKEN}`, (route) =>
				route.fulfill({
					status: 200,
					json: { wg: { name: 'Altbau', shareCode: FIXTURE_WG.shareCode } },
				}),
			);
			await page.goto(`/invite/${TOKEN}`);
			await expect(page.getByLabel('Dein Anzeigename')).toBeVisible({ timeout: 60_000 });
		}

		test('a taken name keeps its error, marks the field and moves focus back to it', async ({
			page,
		}) => {
			await page.route('**/api/wg/*/members', (route) =>
				route.fulfill({ status: 409, json: { error: 'name_taken' } }),
			);
			await openJoinPage(page);
			await page.getByLabel('Dein Anzeigename').fill('Mia');
			await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

			const alert = page.locator('#join-name-error');
			await expect(alert).toContainText('Der Name ist in dieser WG schon vergeben.');
			await page.waitForTimeout(1000);
			await expect(alert).toContainText('Der Name ist in dieser WG schon vergeben.');
			const field = page.locator('#join-name');
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			await expect(field).toHaveAttribute('aria-describedby', 'join-name-error');
			await expect(field).toBeFocused();

			await field.fill('Mia2');
			await expect(alert).toHaveCount(0);
			await expect(field).not.toHaveAttribute('aria-invalid', 'true');
		});

		test('an empty name marks the field, focuses it and clears the error once a name is typed', async ({
			page,
		}) => {
			await openJoinPage(page);
			await page.getByRole('button', { name: 'Beitreten', exact: true }).click();

			const field = page.locator('#join-name');
			await expect(page.locator('#join-name-error')).toBeVisible();
			await expect(field).toHaveAttribute('aria-invalid', 'true');
			await expect(field).toBeFocused();

			await field.fill('Neu');
			await expect(page.locator('#join-name-error')).toHaveCount(0);
		});
	});
});
