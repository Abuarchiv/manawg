import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			if ((await page.locator('body').innerText()).includes('Internal Server Error')) {
				throw new Error('Next dev server returned Internal Server Error');
			}
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

test.describe('WG search recovery', () => {
	test.setTimeout(300_000);

	test('requires a WG member for search API results', async ({ request }) => {
		const response = await request.get('/api/wg/MTE8PZAT/search?q=Miete', {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'member_id_required' });
	});

	test('shows a retryable error instead of an empty result on search failure', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failSearch = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			const url = new URL(route.request().url());
			if (url.searchParams.get('q') === '') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [], suggestions: [] }),
				});
				return;
			}
			if (failSearch) {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'server_error' }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results: [
						{
							id: 'expense-1',
							module: 'ausgaben',
							title: 'Miete Mai',
							meta: '950,00 €',
							href: '/wg/MTE8PZAT/ausgaben?highlight=expense-1',
							tags: ['unpaid'],
						},
					],
					suggestions: ['Miete'],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('Miete');

		await expect(
			page.getByText('Suche konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Nichts gefunden.')).toBeHidden();

		failSearch = false;
		await page.getByRole('button', { name: 'Suche erneut laden' }).click();

		await expect(page.getByText('Miete Mai')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Suche konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains stale membership when search is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			const url = new URL(route.request().url());
			if (url.searchParams.get('q') === '') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [], suggestions: [] }),
				});
				return;
			}
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('Miete');

		await expect(
			page.getByText('Suche konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Suche konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('lets users reset result filters when matches are hidden', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			const url = new URL(route.request().url());
			if (url.searchParams.get('q') === '') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [], suggestions: [] }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results: [
						{
							id: 'expense-1',
							module: 'ausgaben',
							title: 'Miete Mai',
							meta: '950,00 €',
							href: '/wg/MTE8PZAT/ausgaben?highlight=expense-1',
							tags: ['unpaid'],
						},
					],
					suggestions: ['Miete'],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('Miete');
		await expect(page.getByText('Miete Mai')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('status')).toHaveText('1 Treffer sichtbar für "Miete".');
		await expect(page.getByLabel('Schnellfilter', { exact: true })).toBeVisible();
		await expect(page.getByLabel('Suchbereiche filtern', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Schnellfilter: Alle' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await page.getByRole('button', { name: 'Einkauf' }).click();

		await expect(page.getByRole('status')).toHaveText('Keine sichtbaren Treffer für "Miete".');
		await expect(page.getByText('Filter blenden alle Treffer aus.')).toBeVisible();
		await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();

		await expect(page.getByText('Miete Mai')).toBeVisible();
		await expect(page.getByRole('status')).toHaveText('1 Treffer sichtbar für "Miete".');
		await expect(page.getByText('Filter blenden alle Treffer aus.')).toBeHidden();
	});

	test('lets users clear the current search from the input', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			const url = new URL(route.request().url());
			if (url.searchParams.get('q') === '') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [], suggestions: ['Miete'] }),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results: [
						{
							id: 'expense-1',
							module: 'ausgaben',
							title: 'Miete Mai',
							meta: '950,00 €',
							href: '/wg/MTE8PZAT/ausgaben?highlight=expense-1',
							tags: ['unpaid'],
						},
					],
					suggestions: ['Miete'],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('Miete');
		await expect(page.getByText('Miete Mai')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Suche leeren' }).click();

		await expect(page.getByPlaceholder('Milch, Bad, Miete...')).toHaveValue('');
		await expect(page.getByText('Miete Mai')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Miete' })).toBeVisible();
	});

	test('guides users when a search has no matches', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ results: [], suggestions: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('Unauffindbar');

		await expect(page.getByText('Keine Treffer für "Unauffindbar"')).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Versuche ein kürzeres Wort oder spring direkt')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Zur Pinnwand' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/pinnwand',
		);
		await page.getByRole('button', { name: 'Suchfeld leeren' }).click();
		await expect(page.getByPlaceholder('Milch, Bad, Miete...')).toHaveValue('');
		await expect(page.getByText('Keine Treffer für "Unauffindbar"')).toBeHidden();
	});

	test('keeps newer search results when an older request finishes later', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let releaseOldSearch: () => void = () => undefined;
		const oldSearchCanFinish = new Promise<void>((resolve) => {
			releaseOldSearch = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/search**', async (route) => {
			const url = new URL(route.request().url());
			const query = url.searchParams.get('q') ?? '';
			if (query === '') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ results: [], suggestions: [] }),
				});
				return;
			}
			if (query === 'alt') {
				await oldSearchCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						results: [
							{
								id: 'old-result',
								module: 'einkauf',
								title: 'Alte Milch',
								meta: 'Einkauf',
								href: '/wg/MTE8PZAT/einkauf?highlight=old-result',
								tags: ['open'],
							},
						],
						suggestions: ['alt'],
					}),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					results: [
						{
							id: 'fresh-result',
							module: 'einkauf',
							title: 'Frischer Kaffee',
							meta: 'Einkauf',
							href: '/wg/MTE8PZAT/einkauf?highlight=fresh-result',
							tags: ['open'],
						},
					],
					suggestions: ['frisch'],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/suche');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('alt');
		await page.getByPlaceholder('Milch, Bad, Miete...').fill('frisch');

		await expect(page.getByText('Frischer Kaffee')).toBeVisible({ timeout: 30_000 });
		releaseOldSearch();

		await expect(page.getByText('Frischer Kaffee')).toBeVisible();
		await expect(page.getByText('Alte Milch')).toBeHidden();
	});
});
