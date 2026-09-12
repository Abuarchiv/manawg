import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			if (
				await page
					.getByText('Seite nicht gefunden')
					.isVisible()
					.catch(() => false)
			) {
				throw new Error('not-found-during-warmup');
			}
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

test.describe('Shopping recovery', () => {
	test.setTimeout(240_000);

	test('requires a WG member for shopping API data', async ({ request }) => {
		const response = await request.get('/api/wg/MTE8PZAT/shopping', {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'member_id_required' });
	});

	test('shows a retryable load error instead of an empty shopping list', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let failShopping = true;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (failShopping) {
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
					items: [
						{
							id: 'shopping-1',
							addedByMemberId: memberId,
							name: 'Hafermilch',
							quantity: '2x',
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');

		await expect(
			page.getByText('Einkaufsliste konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText('Noch nichts auf der Liste.')).toBeHidden();

		failShopping = false;
		await page.getByRole('button', { name: 'Liste erneut laden' }).click();

		await expect(page.getByText('Hafermilch')).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByText('Einkaufsliste konnte nicht geladen werden: Versuche es gleich erneut.'),
		).toBeHidden();
	});

	test('explains stale membership when shopping load is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');

		await expect(
			page.getByText('Einkaufsliste konnte nicht geladen werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Einkaufsliste konnte nicht geladen werden.')).toHaveCount(0);
	});

	test('explains stale membership when adding a shopping item is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Hafermilch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText('Artikel konnte nicht gespeichert werden: Tritt der WG erneut bei.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toHaveCount(0);
	});

	test('explains server failures when adding a shopping item fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Hafermilch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText('Artikel konnte nicht gespeichert werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toHaveCount(0);
		await expect(page.getByPlaceholder('Was brauchen wir?')).toHaveValue('Hafermilch');
	});

	test('announces offline toggle success for existing shopping items as status', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const itemId = '5f6b9043-9f2f-45ab-b377-7c9f9b45c816';
		const offlineNotice =
			'Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: itemId,
								addedByMemberId: memberId,
								name: 'Hafermilch',
								quantity: '2x',
								boughtAt: null,
								boughtByMemberId: null,
								createdAt: new Date().toISOString(),
							},
						],
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route(`**/api/wg/MTE8PZAT/shopping/${itemId}`, async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.abort('internetdisconnected');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByRole('checkbox', { name: 'Hafermilch erledigen', exact: true }).click();

		await expect(page.getByRole('alert').filter({ hasText: offlineNotice })).toHaveCount(1);
	});

	test('announces offline toggle success for queued shopping items as status', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const queuedId = 'shopping:MTE8PZAT:1710000000000:hafermilch';
		const createdAt = new Date(1_710_000_000_000).toISOString();
		const offlineNotice =
			'Offline vorgemerkt. Der neue Artikel wird direkt als erledigt synchronisiert.';

		await page.addInitScript(
			({ wgId, memberId, queuedId, createdAt }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: queuedId,
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt,
							payload: { name: 'Hafermilch', quantity: '2x' },
						},
					]),
				);
			},
			{ wgId, memberId, queuedId, createdAt },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: queuedId,
								addedByMemberId: memberId,
								name: 'Hafermilch',
								quantity: '2x',
								boughtAt: null,
								boughtByMemberId: null,
								createdAt,
							},
						],
					}),
				});
				return;
			}
			if (route.request().method() === 'POST') {
				await route.abort('internetdisconnected');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByRole('checkbox', { name: 'Hafermilch erledigen', exact: true }).click();

		await expect(page.getByRole('alert').filter({ hasText: offlineNotice })).toHaveCount(1);
	});

	test('explains server failures when clearing bought shopping items fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: 'shopping-done-1',
								addedByMemberId: memberId,
								name: 'Kaffee',
								quantity: '1 Packung',
								boughtAt: new Date().toISOString(),
								boughtByMemberId: memberId,
								createdAt: new Date().toISOString(),
							},
						],
					}),
				});
				return;
			}
			if (route.request().method() === 'DELETE') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'server_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await expect(page.getByText('Kaffee')).toBeVisible({ timeout: 30_000 });
		const clearButton = page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' });
		await clearButton.click();
		const clearDialog = page.getByRole('alertdialog');
		await expect(clearDialog).toBeVisible();
		await clearDialog.getByRole('button', { name: 'Entfernen', exact: true }).click();

		await expect(
			page.getByText('Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Erledigte konnten nicht entfernt werden.')).toHaveCount(0);
		await expect(page.getByText('Kaffee')).toBeVisible();
		await expect(clearButton).toBeEnabled();
	});
	test('prefills the add form from empty-list suggestions', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [] }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await expect(page.getByText('Noch nichts auf der Liste', { exact: true })).toBeVisible({
			timeout: 30_000,
		});

		await page.getByRole('button', { name: 'Kaffee' }).click();

		await expect(page.getByPlaceholder('Was brauchen wir?')).toHaveValue('Kaffee');
		await expect(page.getByLabel('Menge', { exact: true })).toHaveValue('1 Packung');
		await expect(page.getByPlaceholder('Was brauchen wir?')).toBeFocused();
	});
});
