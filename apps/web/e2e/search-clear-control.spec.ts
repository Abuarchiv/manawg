import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember } from './_helpers';

const scenarios = [
	{ width: 320, fontSize: 16, colorScheme: 'light' as const },
	{ width: 320, fontSize: 32, colorScheme: 'dark' as const },
	{ width: 360, fontSize: 16, colorScheme: 'dark' as const },
	{ width: 360, fontSize: 32, colorScheme: 'light' as const },
];

test.describe('search clear control', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	for (const scenario of scenarios) {
		test(`keeps one clear action and restores focus (${scenario.width}px, ${scenario.fontSize}px, ${scenario.colorScheme})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: scenario.width, height: 740 });
			await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: 'reduce' });
			await setupMember(page);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}`, (route) =>
				route.fulfill({
					json: {
						currentMember: {
							memberId: FIXTURE_WG.memberId,
							name: FIXTURE_WG.memberName,
						},
					},
				}),
			);
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/search*`, (route) =>
				route.fulfill({ json: { results: [], suggestions: [] } }),
			);

			await page.goto(`/wg/${FIXTURE_WG.shareCode}/suche`);
			const search = page.getByRole('searchbox', { name: 'Suchbegriff' });
			await expect(search).toBeVisible();
			if (scenario.fontSize === 32) {
				await page.evaluate(() => {
					document.documentElement.style.setProperty('font-size', '32px', 'important');
				});
			}
			await search.fill('Milch');

			const clear = page.getByRole('button', { name: 'Suche leeren' });
			await expect(clear).toBeVisible();
			await expect(search).toHaveAttribute('type', 'text');
			await expect(search).toHaveAttribute('role', 'searchbox');
			await expect(search).toHaveAttribute('enterkeyhint', 'search');
			await expect(clear).toHaveCount(1);

			await clear.focus();
			await clear.press('Enter');
			await expect(search).toHaveValue('');
			await expect(search).toBeFocused();

			await search.fill('Bad');
			await clear.click();
			await expect(search).toHaveValue('');
			await expect(search).toBeFocused();
		});
	}
});
