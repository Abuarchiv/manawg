import { type Page, expect, test } from '@playwright/test';

async function gotoWithRetry(page: Page, path: string) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			return;
		} catch (err) {
			lastError = err;
			await page.waitForTimeout(1000);
		}
	}
	throw lastError;
}

test.describe('Settings access controls', () => {
	test.setTimeout(300_000);

	test('recovers when joining toggle fails with a network error', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		const toggle = page.getByRole('button', { name: 'Neue Beitritte sperren' });
		await expect(toggle).toBeVisible({ timeout: 30_000 });

		await toggle.click();

		await expect(
			page.getByText(
				'Zugang konnte nicht geändert werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible();
		await expect(page.getByText('Netzwerkfehler. Zugang wurde nicht geändert.')).toHaveCount(0);
		await expect(toggle).toBeEnabled();
		await expect(toggle).toHaveText('Erlaubt');
	});

	test('explains stale WG links when joining access cannot be changed', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'wg_not_found', code: 'wg_not_found' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		const toggle = page.getByRole('button', { name: 'Neue Beitritte sperren' });
		await expect(toggle).toBeVisible({ timeout: 30_000 });

		await toggle.click();

		await expect(
			page.getByText('Diese WG wurde nicht gefunden. Öffne sie über den aktuellen WG-Link erneut.'),
		).toBeVisible();
		await expect(page.getByText('Zugang konnte nicht geändert werden.')).toHaveCount(0);
		await expect(toggle).toBeEnabled();
	});

	test('explains server failures when joining access cannot be changed', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error', code: 'unexpected_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		const toggle = page.getByRole('button', { name: 'Neue Beitritte sperren' });
		await expect(toggle).toBeVisible({ timeout: 30_000 });

		await toggle.click();

		await expect(
			page.getByText('Zugang konnte nicht geändert werden: Versuche es gleich erneut.'),
		).toBeVisible();
		await expect(page.getByText('Zugang konnte nicht geändert werden.')).toHaveCount(0);
		await expect(page.getByText('unexpected_error')).toBeHidden();
		await expect(toggle).toBeEnabled();
	});

	test('does not send duplicate joining toggle requests from rapid clicks', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let patchRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'PATCH') {
				patchRequests += 1;
				await new Promise((resolve) => setTimeout(resolve, 300));
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wg: {
							id: wgId,
							name: 'sadf',
							shareCode: 'MTE8PZAT',
							joiningEnabled: false,
							shareCodeRotatedAt: null,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		const toggle = page.getByRole('button', { name: 'Neue Beitritte sperren' });
		await expect(toggle).toBeVisible({ timeout: 30_000 });

		await toggle.evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => patchRequests).toBe(1);
		await expect(
			page.getByRole('status').filter({ hasText: 'Neue Beitritte sind gesperrt.' }),
		).toBeVisible();
	});

	test('announces the share-code rotation confirmation step', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'WG-Code erneuern' }).click();

		await expect(page.getByRole('button', { name: 'WG-Code-Erneuerung bestätigen' })).toBeVisible();
		await expect(page.getByRole('status')).toHaveText(
			'Klicke erneut auf Bestätigen, um den WG-Code zu erneuern.',
		);
	});

	test('clears stale share-code confirmation when joining access is changed', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'PATCH') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wg: {
							id: wgId,
							name: 'sadf',
							shareCode: 'MTE8PZAT',
							joiningEnabled: false,
							shareCodeRotatedAt: null,
						},
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'WG-Code erneuern' }).click();
		await expect(page.getByRole('button', { name: 'WG-Code-Erneuerung bestätigen' })).toBeVisible();

		await page.getByRole('button', { name: 'Neue Beitritte sperren' }).click();

		await expect(page.getByRole('button', { name: 'WG-Code erneuern' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG-Code-Erneuerung bestätigen' })).toHaveCount(
			0,
		);
	});

	test('keeps destructive danger-zone confirmations mutually exclusive', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'WG auf diesem Gerät verlassen' }).click();
		await expect(page.getByText('Wirklich verlassen?')).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG-Verlassen abbrechen' })).toBeVisible();

		await page.getByRole('button', { name: 'Komplette WG für alle löschen' }).click();

		await expect(page.getByText('Wirklich verlassen?')).toHaveCount(0);
		await expect(page.getByLabel('WG-Code zur Bestätigung')).toBeVisible();
		await expect(page.getByRole('button', { name: 'WG-Löschung abbrechen' })).toBeVisible();

		await page.getByRole('button', { name: 'WG auf diesem Gerät verlassen' }).click();

		await expect(page.getByText('Wirklich verlassen?')).toBeVisible();
		await expect(page.getByLabel('WG-Code zur Bestätigung')).toHaveCount(0);
	});

	test('explains when deleting an already-missing WG fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'wg_not_found', code: 'wg_not_found' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'Komplette WG für alle löschen' }).click();
		await page.getByLabel('WG-Code zur Bestätigung').fill('MTE8PZAT');
		await page.getByRole('button', { name: 'WG endgültig löschen' }).click();

		await expect(
			page.getByText(
				'Diese WG wurde nicht gefunden. Sie wurde möglicherweise schon gelöscht oder der Link ist veraltet.',
			),
		).toBeVisible();
		await expect(
			page.getByText('Löschen fehlgeschlagen. Bitte später erneut versuchen.'),
		).toHaveCount(0);
	});

	test('explains server failures when deleting a WG fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'unexpected_error', code: 'unexpected_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'Komplette WG für alle löschen' }).click();
		await page.getByLabel('WG-Code zur Bestätigung').fill('MTE8PZAT');
		await page.getByRole('button', { name: 'WG endgültig löschen' }).click();

		await expect(
			page.getByText('WG konnte nicht gelöscht werden: Versuche es gleich erneut.'),
		).toBeVisible();
		await expect(
			page.getByText('Löschen fehlgeschlagen. Bitte später erneut versuchen.'),
		).toHaveCount(0);
		await expect(page.getByText('unexpected_error')).toBeHidden();
	});

	test('explains network failures when deleting a WG fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT', async (route) => {
			if (route.request().method() === 'DELETE') {
				await route.abort('failed');
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#zugang');
		await page.getByRole('button', { name: 'Komplette WG für alle löschen' }).click();
		await page.getByLabel('WG-Code zur Bestätigung').fill('MTE8PZAT');
		await page.getByRole('button', { name: 'WG endgültig löschen' }).click();

		await expect(
			page.getByText(
				'WG konnte nicht gelöscht werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible();
		await expect(page.getByText('Netzwerkfehler.')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'WG endgültig löschen' })).toBeEnabled();
	});

	test('keeps queued actions visible when discarding cannot be persisted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-storage-blocked',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: { name: 'Milch', quantity: '1L' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Milch')).toBeVisible({ timeout: 30_000 });
		await page.evaluate(() => {
			const originalSetItem = Storage.prototype.setItem;
			Object.defineProperty(Storage.prototype, 'setItem', {
				configurable: true,
				value(key: string, value: string) {
					if (key === 'manawg:offline-actions') throw new Error('blocked');
					return originalSetItem.call(this, key, value);
				},
			});
		});

		await page.getByRole('button', { name: 'Offline-Aktion verwerfen: Milch' }).click();

		await expect(
			page.getByText('Offline-Speicher ist blockiert. Die Aktion konnte nicht verworfen werden.'),
		).toBeVisible();
		await expect(page.getByText('Milch')).toBeVisible();
	});

	test('keeps mobile queued actions visible when private-mode storage blocks discards', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.setViewportSize({ width: 390, height: 844 });
		await page.addInitScript(
			({ wgId, memberId }) => {
				Object.defineProperty(navigator, 'maxTouchPoints', {
					configurable: true,
					get: () => 1,
				});
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-mobile-storage-blocked',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: { name: 'Hafermilch', quantity: '1L' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Hafermilch')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('navigation', { name: 'WG Hauptnavigation' })).toBeVisible();
		await page.evaluate(() => {
			const originalSetItem = Storage.prototype.setItem;
			Object.defineProperty(Storage.prototype, 'setItem', {
				configurable: true,
				value(key: string, value: string) {
					if (key === 'manawg:offline-actions') throw new Error('private-mode quota');
					return originalSetItem.call(this, key, value);
				},
			});
		});

		await page.getByRole('button', { name: 'Offline-Aktion verwerfen: Hafermilch' }).click();

		await expect(
			page.getByText('Offline-Speicher ist blockiert. Die Aktion konnte nicht verworfen werden.'),
		).toBeVisible();
		await expect(page.getByText('Hafermilch')).toBeVisible();
	});

	test('uses plural text for multiple queued offline actions', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-plural-1',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: new Date().toISOString(),
							attempts: 1,
							payload: { name: 'Milch', quantity: '1L' },
						},
						{
							id: 'shopping:MTE8PZAT:e2e-plural-2',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: new Date().toISOString(),
							attempts: 1,
							payload: { name: 'Brot', quantity: null },
						},
					]),
				);
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');

		await expect(page.getByText('2 Aktionen warten.')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('2 Aktionen wartet.')).toHaveCount(0);
		await expect(page.getByText('Milch')).toBeVisible();
		await expect(page.getByText('Brot')).toBeVisible();
	});

	test('does not start duplicate manual queue syncs from rapid clicks', async ({ page }) => {
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
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-sync-once',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: { name: 'Butter', quantity: '1' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'POST') {
				postRequests += 1;
				await postCanFinish;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Butter')).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Offline-Warteschlange erneut synchronisieren' })
			.evaluate((button) => {
				button.click();
				button.click();
			});

		await expect.poll(() => postRequests).toBe(1);
		await expect(
			page.getByRole('button', { name: 'Offline-Warteschlange wird synchronisiert' }),
		).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Server prüfen: Butter' })).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Offline-Aktion bearbeiten: Butter' }),
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Offline-Aktion verwerfen: Butter' }),
		).toBeDisabled();
		releasePost?.();
	});

	test('checks queued shopping status updates against the server', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const itemId = 'b7b70591-3ad9-4a9f-80f4-8c20a85ff77a';

		await page.addInitScript(
			({ wgId, memberId, itemId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping-update:MTE8PZAT:e2e-check',
							type: 'shopping.update',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							payload: { itemId, name: 'Milch', bought: true },
						},
					]),
				);
			},
			{ wgId, memberId, itemId },
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
								quantity: '1L',
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

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Milch abhaken')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Server prüfen: Milch abhaken' }).click();

		await expect(
			page.getByRole('status').filter({
				hasText:
					'Server-Version gefunden. Status dort: offen. Prüfe vor dem erneuten Senden, ob das noch stimmt.',
			}),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
	});

	test('does not treat failed server checks as missing queued duplicates', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-check-fails',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: new Date().toISOString(),
							attempts: 1,
							payload: { name: 'Milch', quantity: '1L' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'server_error' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Milch')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Server prüfen: Milch' }).click();

		await expect(
			page.getByText(
				'Server-Vergleich konnte nicht geladen werden. Versuche es erneut, bevor du diese Aktion sendest.',
			),
		).toBeVisible();
		await expect(page.getByText('Kein gleichnamiger Einkaufsartikel')).toHaveCount(0);
	});

	test('explains stale member server checks for queued offline actions', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-check-stale-member',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: new Date().toISOString(),
							attempts: 1,
							payload: { name: 'Kaffee', quantity: '500g' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'not_a_member' }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Kaffee')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Server prüfen: Kaffee' }).click();

		await expect(
			page.getByRole('status').filter({
				hasText:
					'Mitglied nicht mehr gültig: Öffne die WG erneut oder tritt mit einem aktuellen Einladungslink bei, bevor du diese Aktion sendest.',
			}),
		).toBeVisible();
		await expect(page.getByText('Server-Vergleich konnte nicht geladen werden')).toHaveCount(0);
	});

	test('does not send duplicate server checks from rapid clicks', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let getRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'shopping:MTE8PZAT:e2e-check-once',
							type: 'shopping.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: new Date().toISOString(),
							attempts: 1,
							payload: { name: 'Hafermilch', quantity: '1L' },
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() === 'GET') {
				getRequests += 1;
				await new Promise((resolve) => setTimeout(resolve, 300));
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ items: [] }),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Hafermilch')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Server prüfen: Hafermilch' }).evaluate((button) => {
			button.click();
			button.click();
		});

		await expect.poll(() => getRequests).toBe(1);
		await expect(
			page.getByText('Kein gleichnamiger Einkaufsartikel auf dem Server gefunden.'),
		).toBeVisible();
	});

	test('confirms queued attachment removal for missing offline images', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'announcement:MTE8PZAT:e2e-missing-image',
							type: 'announcement.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							lastError:
								'Bild fehlt: Der lokale Anhang ist auf diesem Gerät nicht mehr verfügbar. Entferne den Anhang oder wähle das Bild erneut aus.',
							payload: {
								content: 'Foto vom Zähler',
								kind: 'info',
								imageUrl: 'manawg-pending-image:lost-photo',
							},
						},
					]),
				);
			},
			{ wgId, memberId },
		);

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Foto vom Zähler')).toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'Anhang entfernen: Foto vom Zähler' }).click();

		await expect(
			page.getByRole('status').filter({
				hasText: 'Anhang entfernt. Die Offline-Aktion kann wieder synchronisiert werden.',
			}),
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Anhang entfernen: Foto vom Zähler' }),
		).toHaveCount(0);
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const queue = JSON.parse(
						localStorage.getItem('manawg:offline-actions') ?? '[]',
					) as Array<{
						payload?: { imageUrl?: string | null };
					}>;
					return queue[0]?.payload && 'imageUrl' in queue[0].payload
						? queue[0].payload.imageUrl
						: 'missing';
				}),
			)
			.toBeNull();
	});

	test('shows concrete server check notes for queued create actions', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'announcement:MTE8PZAT:e2e-check',
							type: 'announcement.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: { content: 'Paket liegt im Flur', kind: 'info', imageUrl: null },
						},
						{
							id: 'chore-create:MTE8PZAT:e2e-check',
							type: 'chore.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: {
								title: 'Bad putzen',
								intervalDays: 7,
								assignedMemberId: memberId,
							},
						},
						{
							id: 'expense:MTE8PZAT:e2e-check',
							type: 'expense.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: {
								description: 'Strom',
								amountCents: 4200,
								paidByMemberId: memberId,
								splits: [{ debtorMemberId: memberId, amountCents: 4200 }],
								imageUrl: null,
							},
						},
						{
							id: 'recurring:MTE8PZAT:e2e-check',
							type: 'recurring.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							lastAttemptAt: '2099-01-01T00:00:00.000Z',
							attempts: 1,
							payload: {
								description: 'Internet',
								amountCents: 3200,
								paidByMemberId: memberId,
								intervalMonths: 1,
								nextDueAt: '2026-06-01T00:00:00.000Z',
								splits: [{ debtorMemberId: memberId, amountCents: 3200 }],
							},
						},
					]),
				);
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/announcements', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						announcements: [
							{
								id: 'announcement-server',
								content: 'Paket liegt im Flur',
								resolvedAt: null,
							},
						],
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/chores', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						chores: [
							{
								id: 'chore-server',
								title: 'Bad putzen',
								assignedMemberId: memberId,
								intervalDays: 7,
							},
						],
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/expenses', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						expenses: [{ id: 'expense-server', description: 'Strom', amountCents: 4200 }],
					}),
				});
				return;
			}
			await route.fallback();
		});
		await page.route('**/api/wg/MTE8PZAT/recurring-expenses', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						recurringExpenses: [
							{
								id: 'recurring-server',
								description: 'Internet',
								amountCents: 3200,
								nextDueAt: '2026-07-01T00:00:00.000Z',
							},
						],
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Paket liegt im Flur')).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Bad putzen')).toBeVisible();
		await expect(page.getByText('Strom')).toBeVisible();
		await expect(page.getByText('Internet')).toBeVisible();

		await page.getByRole('button', { name: 'Server prüfen: Paket liegt im Flur' }).click();
		await expect(
			page.getByText(
				'Gleicher Pinnwand-Beitrag existiert schon. Status dort: offen. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
			),
		).toBeVisible();

		await page.getByRole('button', { name: 'Server prüfen: Bad putzen' }).click();
		await expect(
			page.getByText(
				'Gleiche Putzaufgabe existiert schon. Intervall dort: alle 7 Tage. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
			),
		).toBeVisible();

		await page.getByRole('button', { name: 'Server prüfen: Strom' }).click();
		await expect(
			page.getByText(
				'Gleiche Ausgabe mit gleichem Betrag existiert schon. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
			),
		).toBeVisible();

		await page.getByRole('button', { name: 'Server prüfen: Internet' }).click();
		await expect(
			page.getByText(
				'Gleiche Fixkosten-Vorlage existiert schon. Nächste Fälligkeit dort: 1.7.2026. Prüfe vor dem Senden, ob es ein Duplikat wäre.',
			),
		).toBeVisible();
	});

	test('checks queued absences with the current member identity', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		const absenceMemberId = '11111111-1111-4111-8111-111111111111';
		let authHeader: string | null = null;

		await page.addInitScript(
			({ wgId, memberId, absenceMemberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
				localStorage.setItem(
					'manawg:offline-actions',
					JSON.stringify([
						{
							id: 'absence:MTE8PZAT:e2e-check',
							type: 'absence.create',
							shareCode: 'MTE8PZAT',
							memberId,
							createdAt: new Date().toISOString(),
							attempts: 1,
							payload: {
								memberId: absenceMemberId,
								startDate: '2026-06-01T00:00:00.000Z',
								endDate: '2026-06-03T00:00:00.000Z',
								reason: 'Urlaub',
							},
						},
					]),
				);
			},
			{ wgId, memberId, absenceMemberId },
		);
		await page.route('**/api/wg/MTE8PZAT/absences', async (route) => {
			if (route.request().method() === 'GET') {
				authHeader = route.request().headers()['x-manawg-member-id'] ?? null;
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						absences: [
							{
								id: 'absence-server',
								memberId: absenceMemberId,
								startDate: '2026-06-01T00:00:00.000Z',
								endDate: '2026-06-03T00:00:00.000Z',
							},
						],
					}),
				});
				return;
			}
			await route.fallback();
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await expect(page.getByText('Abwesenheit', { exact: true })).toBeVisible({ timeout: 30_000 });

		await page
			.getByRole('button', { name: 'Server prüfen: Rotation überspringt diese Person' })
			.click();

		await expect(
			page.getByText('Gleiche Abwesenheit existiert schon auf dem Server.'),
		).toBeVisible();
		expect(authHeader).toBe(memberId);
	});
});
