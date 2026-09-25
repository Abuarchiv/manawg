import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember } from './_helpers';

const scenarios = [
	{ width: 320, fontSize: 16, colorScheme: 'light' as const },
	{ width: 320, fontSize: 16, colorScheme: 'dark' as const },
	{ width: 320, fontSize: 32, colorScheme: 'dark' as const },
	{ width: 320, fontSize: 32, colorScheme: 'light' as const },
	{ width: 360, fontSize: 16, colorScheme: 'dark' as const },
	{ width: 360, fontSize: 16, colorScheme: 'light' as const },
	{ width: 360, fontSize: 32, colorScheme: 'light' as const },
	{ width: 360, fontSize: 32, colorScheme: 'dark' as const },
];

test.describe('search result row at narrow widths and large text', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	for (const scenario of scenarios) {
		test(`keeps result text readable (${scenario.width}px, ${scenario.fontSize}px, ${scenario.colorScheme})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: scenario.width, height: 900 });
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
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/search*`, (route) => {
				const query = new URL(route.request().url()).searchParams.get('q') ?? '';
				return route.fulfill({
					json: {
						results: query
							? [
									{
										id: 'absence',
										module: 'abwesenheiten',
										title: 'Alex Schwarzenberger ist abwesend',
										meta: 'Abwesenheit vom 25.09.2026 bis 02.10.2026',
										href: `/wg/${FIXTURE_WG.shareCode}/putzen/abwesenheiten`,
									},
								]
							: [],
						suggestions: [],
					},
				});
			});

			await page.goto(`/wg/${FIXTURE_WG.shareCode}/suche`);
			const search = page.getByRole('searchbox', { name: 'Suchbegriff' });
			await expect(search).toBeVisible();
			if (scenario.fontSize === 32) {
				await page.evaluate(() => {
					document.documentElement.style.setProperty('font-size', '32px', 'important');
				});
			}
			await search.fill('abwesend');

			const result = page.getByRole('link', {
				name: 'Alex Schwarzenberger ist abwesend — Abwesenheiten',
			});
			await expect(result).toBeVisible();
			const rowBox = await result.boundingBox();
			const contentBox = await result.locator('[data-slot="item-content"]').boundingBox();
			const titleBox = await result.locator('[data-slot="item-title"]').boundingBox();
			const metaBox = await result.locator('[data-slot="item-description"]').boundingBox();
			const badgeBox = await result.locator('[data-slot="badge"]').boundingBox();
			if (!rowBox || !contentBox || !titleBox || !metaBox || !badgeBox) {
				throw new Error('Search result row geometry is unavailable');
			}

			expect(contentBox.width).toBeGreaterThan(
				rowBox.width * (scenario.fontSize === 32 ? 0.65 : 0.4),
			);
			expect(titleBox.width).toBeGreaterThan(contentBox.width * 0.8);
			expect(metaBox.width).toBeGreaterThan(contentBox.width * 0.8);
			if (scenario.fontSize === 32) {
				expect(badgeBox.y).toBeGreaterThanOrEqual(contentBox.y + contentBox.height - 1);
			} else {
				expect(badgeBox.y).toBeLessThan(contentBox.y + contentBox.height);
			}
			expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(scenario.width);
		});
	}
});
