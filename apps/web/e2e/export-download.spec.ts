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

test.describe('Settings export download', () => {
	test.setTimeout(300_000);

	test('announces a successful JSON export start', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					wg: { name: 'sadf', shareCode: 'MTE8PZAT' },
					exportedAt: new Date().toISOString(),
					sections: {
						members: [],
						expenses: [],
						recurringExpenses: [],
						shoppingItems: [],
						chores: [],
						absences: [],
						announcements: [],
						auditEvents: [],
					},
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await page.getByRole('button', { name: 'WG-Daten als JSON exportieren' }).click();

		await expect(
			page.getByRole('region', { name: 'Datenexport' }).getByRole('alert'),
		).toContainText('JSON-Export gestartet. Die Datei wird im Browser-Download gespeichert.');
	});

	test('exports the selected CSV section with a clear status', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let csvRequestUrl = '';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			const url = route.request().url();
			if (url.includes('format=csv')) {
				csvRequestUrl = url;
				await route.fulfill({
					status: 200,
					contentType: 'text/csv',
					body: 'id,name,createdAt\nmember-1,dsaf,2026-05-19T00:00:00.000Z\n',
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					wg: { name: 'sadf', shareCode: 'MTE8PZAT' },
					exportedAt: new Date().toISOString(),
					sections: {
						members: [{ id: 'member-1', name: 'dsaf', createdAt: '2026-05-19T00:00:00.000Z' }],
						expenses: [],
						recurringExpenses: [],
						shoppingItems: [],
						chores: [],
						absences: [],
						announcements: [],
						auditEvents: [],
					},
				}),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await page.getByLabel('CSV-Bereich').selectOption('members');
		await page.getByRole('button', { name: 'Mitglieder als CSV exportieren' }).click();

		await expect.poll(() => csvRequestUrl).toContain('format=csv');
		expect(csvRequestUrl).toContain('section=members');
		await expect(
			page.getByRole('region', { name: 'Datenexport' }).getByRole('alert'),
		).toContainText(
			'Mitglieder-Export gestartet. Die CSV-Datei wird im Browser-Download gespeichert.',
		);
	});

	test('explains network failures when the export request is interrupted', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let exportRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			exportRequests += 1;
			if (exportRequests === 1) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wg: { name: 'sadf', shareCode: 'MTE8PZAT' },
						exportedAt: new Date().toISOString(),
						sections: {
							members: [],
							expenses: [],
							recurringExpenses: [],
							shoppingItems: [],
							chores: [],
							absences: [],
							announcements: [],
							auditEvents: [],
						},
					}),
				});
				return;
			}
			await route.abort('failed');
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		const exportButton = page.getByRole('button', { name: 'WG-Daten als JSON exportieren' });
		await expect(exportButton).toBeVisible({ timeout: 30_000 });

		await exportButton.click();

		await expect(
			page.getByText(
				'Export konnte nicht erstellt werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Export konnte nicht erstellt werden.')).toHaveCount(0);
		await expect(exportButton).toBeEnabled();
	});

	test('explains stale membership when export download is denied', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let exportRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			exportRequests += 1;
			if (exportRequests === 1) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wg: { name: 'sadf', shareCode: 'MTE8PZAT' },
						exportedAt: new Date().toISOString(),
						sections: {
							members: [],
							expenses: [],
							recurringExpenses: [],
							shoppingItems: [],
							chores: [],
							absences: [],
							announcements: [],
							auditEvents: [],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 401,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'not_a_member', code: 'not_a_member' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		await page.getByRole('button', { name: 'WG-Daten als JSON exportieren' }).click();

		await expect(
			page.getByText('Export konnte nicht erstellt werden: Tritt der WG erneut bei.'),
		).toBeVisible();
		await expect(page.getByText('Export konnte nicht erstellt werden.')).toHaveCount(0);
	});

	test('explains server failures when export download fails', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let exportRequests = 0;

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			exportRequests += 1;
			if (exportRequests === 1) {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						wg: { name: 'sadf', shareCode: 'MTE8PZAT' },
						exportedAt: new Date().toISOString(),
						sections: {
							members: [],
							expenses: [],
							recurringExpenses: [],
							shoppingItems: [],
							chores: [],
							absences: [],
							announcements: [],
							auditEvents: [],
						},
					}),
				});
				return;
			}
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'unexpected_error' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');
		const exportButton = page.getByRole('button', { name: 'WG-Daten als JSON exportieren' });
		await exportButton.click();

		await expect(
			page.getByText('Export konnte nicht erstellt werden: Versuche es gleich erneut.'),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Export konnte nicht erstellt werden.')).toHaveCount(0);
		await expect(exportButton).toBeEnabled();
	});

	test('keeps CSV section choices available when export summary cannot be loaded', async ({
		page,
	}) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'server_error' }),
			});
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');

		await expect(
			page.getByText(
				'Export-Zusammenfassung konnte nicht geladen werden: Versuche es gleich erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByLabel('CSV-Bereich')).toContainText('Mitglieder');
		await expect(page.getByRole('button', { name: 'Ausgaben als CSV exportieren' })).toBeEnabled();
	});

	test('explains network failures while loading the export summary', async ({ page }) => {
		const wgId = '989ac820-58b7-431f-9c65-28721264f333';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

		await page.addInitScript(
			({ wgId, memberId }) => {
				localStorage.setItem(`manawg_identity:${wgId}`, JSON.stringify({ memberId, name: 'dsaf' }));
			},
			{ wgId, memberId },
		);
		await page.route('**/api/wg/MTE8PZAT/export**', async (route) => {
			await route.abort('failed');
		});

		await gotoWithRetry(page, '/wg/MTE8PZAT/einstellungen#daten');

		await expect(
			page.getByText(
				'Export-Zusammenfassung konnte nicht geladen werden: Prüfe deine Verbindung und versuche es erneut.',
			),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText('Export-Zusammenfassung konnte nicht geladen werden.')).toHaveCount(
			0,
		);
	});
});
