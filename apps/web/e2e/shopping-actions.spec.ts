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

function shoppingRow(page: Page, itemName: string) {
	return page.locator('[data-shopping-row]').filter({
		has: page.getByText(itemName, { exact: true }),
	});
}

function shoppingCheckbox(page: Page, itemName: string, bought = false) {
	return shoppingRow(page, itemName).getByRole('checkbox', {
		name: `${itemName} ${bought ? 'wieder öffnen' : 'erledigen'}`,
		exact: true,
	});
}

async function openShoppingDrawer(page: Page, itemName: string) {
	const row = shoppingRow(page, itemName);
	await row.getByRole('button', { name: `Artikelaktionen: ${itemName}`, exact: true }).click();
	const drawer = page.getByRole('dialog', { name: itemName, exact: true });
	await expect(drawer).toBeVisible();
	return drawer;
}

async function confirmClearBought(page: Page) {
	await page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Entfernen', exact: true }).click();
}

test.describe('Shopping actions', () => {
	test.setTimeout(300_000);

	test('restores quantity-only shopping drafts without overwriting them on load', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					`manawg:draft:MTE8PZAT:${memberId}:shopping`,
					JSON.stringify({ name: '', quantity: '2 Packungen' }),
				);
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

		await expect(page.getByLabel('Menge', { exact: true })).toHaveValue('2 Packungen', {
			timeout: 30_000,
		});
		await expect(page.getByPlaceholder('Was brauchen wir?')).toHaveValue('');
	});

	test('uses item-specific action labels for shopping row controls', async ({ page }) => {
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
				body: JSON.stringify({
					items: [
						{
							id: 'open-1',
							name: 'Milch',
							quantity: '1 Liter',
							addedByMemberId: memberId,
							boughtByMemberId: null,
							boughtAt: null,
							createdAt: new Date().toISOString(),
						},
						{
							id: 'open-2',
							name: 'Brot',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: null,
							boughtAt: null,
							createdAt: new Date().toISOString(),
						},
						{
							id: 'bought-1',
							name: 'Kaffee',
							quantity: '1 Packung',
							addedByMemberId: memberId,
							boughtByMemberId: memberId,
							boughtAt: new Date().toISOString(),
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');

		const milkRow = shoppingRow(page, 'Milch');
		const breadRow = shoppingRow(page, 'Brot');
		const coffeeRow = shoppingRow(page, 'Kaffee');
		await expect(
			milkRow.getByRole('checkbox', { name: 'Milch erledigen', exact: true }),
		).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			breadRow.getByRole('checkbox', { name: 'Brot erledigen', exact: true }),
		).toBeVisible();
		await expect(
			coffeeRow.getByRole('checkbox', { name: 'Kaffee wieder öffnen', exact: true }),
		).toBeVisible();

		const coffeeDrawer = await openShoppingDrawer(page, 'Kaffee');
		await expect(
			coffeeDrawer.getByRole('button', { name: 'Als Ausgabe übernehmen', exact: true }),
		).toBeVisible();
		await coffeeDrawer.getByRole('button', { name: 'Als Ausgabe übernehmen', exact: true }).click();
		await expect(page).toHaveURL(/\/wg\/MTE8PZAT\/ausgaben\?/);
		const handoffUrl = new URL(page.url());
		expect(handoffUrl.searchParams.get('desc')).toBe('Kaffee');
		expect(handoffUrl.searchParams.get('source')).toBe('shopping');
		expect(handoffUrl.searchParams.get('paidBy')).toBe(memberId);
		await expect(coffeeDrawer).toBeHidden();

		await page.goBack();
		await expect(
			milkRow.getByRole('button', { name: 'Artikelaktionen: Milch', exact: true }),
		).toBeVisible();
		const breadDrawer = await openShoppingDrawer(page, 'Brot');
		await breadDrawer.getByRole('button', { name: 'Brot entfernen', exact: true }).click();
		await expect(
			breadDrawer.getByRole('button', { name: 'Brot entfernen bestätigen', exact: true }),
		).toBeVisible();
	});

	test('explains network failures when clearing bought items fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: 'bought-1',
								name: 'Kaffee',
								quantity: '1 Packung',
								addedByMemberId: memberId,
								boughtByMemberId: memberId,
								boughtAt: new Date().toISOString(),
								createdAt: new Date().toISOString(),
							},
						],
					}),
				});
				return;
			}
			if (request.method() === 'DELETE') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await expect(
			page.getByRole('checkbox', { name: 'Kaffee wieder öffnen', exact: true }),
		).toBeVisible({
			timeout: 30_000,
		});

		await confirmClearBought(page);

		await expect(
			page.getByText(
				'Erledigte konnten nicht entfernt werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Erledigte konnten nicht entfernt werden.')).toHaveCount(0);
	});

	test('explains server failures when clearing bought items fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: 'bought-1',
								name: 'Kaffee',
								quantity: '1 Packung',
								addedByMemberId: memberId,
								boughtByMemberId: memberId,
								boughtAt: new Date().toISOString(),
								createdAt: new Date().toISOString(),
							},
						],
					}),
				});
				return;
			}
			if (request.method() === 'DELETE') {
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
		await expect(
			page.getByRole('checkbox', { name: 'Kaffee wieder öffnen', exact: true }),
		).toBeVisible({
			timeout: 30_000,
		});

		await confirmClearBought(page);

		await expect(
			page.getByText('Erledigte konnten nicht entfernt werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Erledigte konnten nicht entfernt werden.')).toHaveCount(0);
	});

	test('removes deleted shopping items after a successful delete', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleted = false;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/open-delete')) {
				deleted = true;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: deleted
						? []
						: [
								{
									id: 'open-delete',
									name: 'Milch',
									quantity: null,
									addedByMemberId: memberId,
									boughtByMemberId: null,
									boughtAt: null,
									createdAt: new Date().toISOString(),
								},
							],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		const milkRow = shoppingRow(page, 'Milch');
		await expect(milkRow).toBeVisible({
			timeout: 30_000,
		});

		const milkDrawer = await openShoppingDrawer(page, 'Milch');
		await milkDrawer.getByRole('button', { name: 'Milch entfernen', exact: true }).click();
		await milkDrawer
			.getByRole('button', { name: 'Milch entfernen bestätigen', exact: true })
			.click();

		await expect(milkRow).toBeHidden({
			timeout: 5000,
		});
	});

	test('explains network failures when removing a shopping item fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping**', async (route) => {
			const request = route.request();
			if (request.method() === 'DELETE' && request.url().endsWith('/open-delete')) {
				await route.abort('failed');
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'open-delete',
							name: 'Milch',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: null,
							boughtAt: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		const milkRow = shoppingRow(page, 'Milch');
		await expect(milkRow).toBeVisible({
			timeout: 30_000,
		});

		const milkDrawer = await openShoppingDrawer(page, 'Milch');
		await milkDrawer.getByRole('button', { name: 'Milch entfernen', exact: true }).click();
		await milkDrawer
			.getByRole('button', { name: 'Milch entfernen bestätigen', exact: true })
			.click();

		await expect(
			page.getByText(
				'Einkaufsaktion konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Entfernen fehlgeschlagen.')).toHaveCount(0);
		await expect(milkRow).toBeVisible();
	});

	test('updates bought state after a successful toggle', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let boughtAt: string | null = null;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/open-toggle')) {
				boughtAt = new Date().toISOString();
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						item: {
							id: 'open-toggle',
							name: 'Milch',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: memberId,
							boughtAt,
							createdAt: new Date().toISOString(),
						},
					}),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'open-toggle',
							name: 'Milch',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: boughtAt ? memberId : null,
							boughtAt,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await expect(shoppingCheckbox(page, 'Milch')).toBeVisible({
			timeout: 30_000,
		});

		await shoppingCheckbox(page, 'Milch').click();

		await expect(shoppingCheckbox(page, 'Milch', true)).toBeVisible({
			timeout: 5000,
		});
		const milkDrawer = await openShoppingDrawer(page, 'Milch');
		await expect(milkDrawer.getByText('Erledigt', { exact: true })).toBeVisible();
	});

	test('removes stale shopping items when a toggle finds them deleted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/stale-toggle')) {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'item_not_found' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'stale-toggle',
							name: 'Milch',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: null,
							boughtAt: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		const milkRow = shoppingRow(page, 'Milch');
		await expect(shoppingCheckbox(page, 'Milch')).toBeVisible({
			timeout: 30_000,
		});

		await shoppingCheckbox(page, 'Milch').click();

		await expect(
			page.getByText(
				'Dieser Einkaufsartikel existiert nicht mehr und wurde aus deiner Liste entfernt.',
			),
		).toBeVisible({ timeout: 5000 });
		await expect(milkRow).toBeHidden({
			timeout: 5000,
		});
		await expect(page.getByText('item_not_found')).toBeHidden();
	});

	test('explains invalid shopping toggles without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping**', async (route) => {
			const request = route.request();
			if (request.method() === 'PATCH' && request.url().endsWith('/invalid-toggle')) {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			if (request.method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'invalid-toggle',
							name: 'Milch',
							quantity: null,
							addedByMemberId: memberId,
							boughtByMemberId: null,
							boughtAt: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await expect(shoppingCheckbox(page, 'Milch')).toBeVisible({
			timeout: 30_000,
		});

		await shoppingCheckbox(page, 'Milch').click();

		await expect(
			page.getByText('Einkaufsaktion konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 5000 });
		await expect(page.getByText('Einkaufsaktion konnte nicht gespeichert werden.')).toHaveCount(0);
		await expect(page.getByText('invalid_body')).toBeHidden();
		await expect(shoppingCheckbox(page, 'Milch')).toBeVisible();
	});

	test('does not send duplicate clear-bought requests from rapid clicks', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let deleteRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						items: [
							{
								id: 'bought-1',
								name: 'Kaffee',
								quantity: '1 Packung',
								addedByMemberId: memberId,
								boughtByMemberId: memberId,
								boughtAt: new Date().toISOString(),
								createdAt: new Date().toISOString(),
							},
						],
					}),
				});
				return;
			}
			if (request.method() === 'DELETE') {
				deleteRequests += 1;
				await new Promise((resolve) => setTimeout(resolve, 300));
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ deleted: 1 }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		const clearButton = page.getByRole('button', { name: /Erledigte Artikel entfernen/ });
		await expect(clearButton).toBeVisible({ timeout: 30_000 });

		await clearButton.click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Entfernen', exact: true }).dblclick();

		await expect.poll(() => deleteRequests).toBe(1);
	});

	test('does not send duplicate add requests from rapid submits', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let postRequests = 0;
		let releasePost: (() => void) | null = null;
		const postCanFinish = new Promise<void>((resolve) => {
			releasePost = resolve;
		});

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			if (request.method() === 'POST') {
				postRequests += 1;
				await postCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 'shopping-created',
						name: 'Bananen',
						quantity: null,
						addedByMemberId: memberId,
						boughtByMemberId: null,
						boughtAt: null,
						createdAt: new Date().toISOString(),
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Bananen');
		await page.getByLabel('Menge', { exact: true }).fill('6 Stück');
		const addButton = page.getByRole('button', { name: 'Artikel hinzufügen' });

		await addButton.evaluate((button) => {
			button.click();
			button.click();
		});

		await expect(addButton).toBeDisabled();
		await expect(page.getByPlaceholder('Was brauchen wir?')).toBeDisabled();
		await expect(page.getByLabel('Menge', { exact: true })).toBeDisabled();
		await expect.poll(() => postRequests).toBe(1);
		releasePost?.();
	});

	test('explains shopping item validation errors without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			if (request.method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'name_invalid' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Bananen');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText(
				'Artikel konnte nicht gespeichert werden: Der Name muss 1 bis 120 Zeichen haben.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('name_invalid')).toHaveCount(0);
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toBeHidden();
	});

	test('explains invalid shopping item requests without raw API codes', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			if (request.method() === 'POST') {
				await route.fulfill({
					status: 400,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'invalid_body' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Bananen');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText('Artikel konnte nicht gespeichert werden: Die Anfrage war ungültig.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('invalid_body')).toHaveCount(0);
		await expect(page.getByText('Hinzufügen fehlgeschlagen.')).toBeHidden();
	});

	test('queues a bought toggle when the network drops', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const itemId = 'b7b70591-3ad9-4a9f-80f4-8c20a85ff77a';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.removeItem('manawg:offline-actions');
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
								name: 'Milch',
								quantity: '2x',
								addedByMemberId: memberId,
								boughtByMemberId: null,
								boughtAt: null,
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
		await expect(page.getByText('Milch')).toBeVisible({ timeout: 30_000 });

		await shoppingCheckbox(page, 'Milch').click();

		await expect(
			page.getByText('Offline vorgemerkt. Der Artikel wird später als erledigt synchronisiert.'),
		).toBeVisible();
		await expect(
			page.getByRole('link', { name: '1 Offline-Aktion wartet auf Synchronisierung.' }),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({
				hasText: /^1 Offline-Eintrag wartet auf Synchronisierung\.$/,
			}),
		).toBeVisible();
		await expect(shoppingCheckbox(page, 'Milch', true)).toBeVisible();

		const queued = await page.evaluate(() =>
			JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]'),
		);
		expect(queued).toMatchObject([
			{
				type: 'shopping.update',
				shareCode: 'MTE8PZAT',
				memberId,
				payload: { itemId, name: 'Milch', bought: true },
			},
		]);
	});

	test('keeps the bought state on an offline-created item without adding a PATCH action', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.removeItem('manawg:offline-actions');
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
				await route.abort('internetdisconnected');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einkauf');
		await page.getByPlaceholder('Was brauchen wir?').fill('Bananen');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Offline gespeichert. Wird synchronisiert' }),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({
				hasText: /^1 Offline-Eintrag wartet auf Synchronisierung\.$/,
			}),
		).toBeVisible();
		await expect(
			page.locator('form').getByText('Artikel konnte nicht gespeichert werden:', { exact: false }),
		).toHaveCount(0);

		await shoppingCheckbox(page, 'Bananen').click();

		await expect(
			page.getByText(
				'Offline vorgemerkt. Der neue Artikel wird direkt als erledigt synchronisiert.',
			),
		).toBeVisible();
		await expect(shoppingCheckbox(page, 'Bananen', true)).toBeVisible();
		const queued = await page.evaluate(() =>
			JSON.parse(localStorage.getItem('manawg:offline-actions') ?? '[]'),
		);
		expect(queued).toMatchObject([
			{
				type: 'shopping.create',
				shareCode: 'MTE8PZAT',
				memberId,
				payload: { name: 'Bananen', quantity: null, bought: true },
			},
		]);
		expect(queued).toHaveLength(1);
	});
});
