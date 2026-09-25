import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember } from './_helpers';

test.setTimeout(300_000);

test('requires a WG member for search API results', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/search?q=Miete', {
		timeout: 120_000,
	});

	expect(response.status()).toBe(401);
	await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
});

test.describe('search errors', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const searchScenarios = [
		{ width: 320, fontSize: 16, colorScheme: 'light' as const },
		{ width: 320, fontSize: 32, colorScheme: 'dark' as const },
		{ width: 360, fontSize: 16, colorScheme: 'dark' as const },
		{ width: 360, fontSize: 32, colorScheme: 'light' as const },
	];

	for (const scenario of searchScenarios) {
		test(`hides previous query results after a search error (${scenario.width}px, ${scenario.fontSize}px, ${scenario.colorScheme})`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: scenario.width, height: 740 });
			await page.emulateMedia({ colorScheme: scenario.colorScheme, reducedMotion: 'reduce' });
			await setupMember(page);

			let rentAttempts = 0;
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
			await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/search*`, async (route) => {
				const query = new URL(route.request().url()).searchParams.get('q') ?? '';
				if (query === 'Milch') {
					return route.fulfill({
						json: {
							results: [
								{
									id: 'milk',
									module: 'einkauf',
									title: 'Milch kaufen',
									meta: 'Einkaufsliste',
									href: `/wg/${FIXTURE_WG.shareCode}/einkauf`,
								},
							],
							suggestions: [],
						},
					});
				}
				if (query === 'Miete') {
					rentAttempts += 1;
					if (rentAttempts === 1) {
						return route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
					}
					return route.fulfill({
						json: {
							results: [
								{
									id: 'rent',
									module: 'ausgaben',
									title: 'Miete Dezember',
									meta: 'Ausgabe der WG',
									href: `/wg/${FIXTURE_WG.shareCode}/ausgaben`,
								},
							],
							suggestions: [],
						},
					});
				}
				return route.fulfill({ json: { results: [], suggestions: [] } });
			});

			await page.goto(`/wg/${FIXTURE_WG.shareCode}/suche`);
			const search = page.getByRole('searchbox', { name: 'Suchbegriff' });
			await expect(search).toBeVisible();
			if (scenario.fontSize === 32) {
				await page.evaluate(() => {
					document.documentElement.style.setProperty('font-size', '32px', 'important');
				});
			}

			const milk = page.getByRole('link', { name: 'Milch kaufen — Einkäufe' });
			await search.fill('Milch');
			await expect(milk).toBeVisible();
			await search.fill('Miete');
			const retry = page.getByRole('button', { name: 'Suche erneut laden' });
			await expect(retry).toBeVisible();
			await expect(milk).toBeHidden();

			await page.getByText('Bereiche eingrenzen').click();
			const absenceFilter = page.getByRole('button', { name: 'Abwesenheiten' });
			await absenceFilter.focus();
			await absenceFilter.press('Space');
			await expect(page.getByText('Filter blenden alle Treffer aus.')).toBeHidden();

			await retry.focus();
			await retry.press('Enter');
			await expect(retry).toBeHidden();
			await expect(page.getByText('Filter blenden alle Treffer aus.')).toBeVisible();
			const resetFilters = page.getByRole('button', { name: 'Filter zurücksetzen' });
			await resetFilters.focus();
			await resetFilters.press('Enter');
			const rent = page.getByRole('link', { name: 'Miete Dezember — Ausgaben' });
			await expect(rent).toBeVisible();

			const clearSearch = page.getByRole('button', { name: 'Suche leeren' });
			await clearSearch.focus();
			await clearSearch.press('Enter');
			await expect(search).toHaveValue('');
			await expect(rent).toBeHidden();
		});
	}
});
