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

async function seedOfflineState(
	page: Page,
	knownWgs: Array<{ code: string; name: string; lastVisitedAt: number }>,
	actions = [
		{
			id: 'shopping:MTE8PZAT:test',
			type: 'shopping.create',
			shareCode: 'MTE8PZAT',
			memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			createdAt: new Date().toISOString(),
			payload: { name: 'Milch', quantity: '1L' },
		},
	],
) {
	await page.waitForLoadState('load');
	await page.evaluate(
		({ wgs, queuedActions }) => {
			window.localStorage.setItem('manawg_known_wgs', JSON.stringify(wgs));
			window.localStorage.setItem('manawg:offline-actions', JSON.stringify(queuedActions));
			window.dispatchEvent(new CustomEvent('manawg:offline-queue'));
		},
		{ queuedActions: actions, wgs: knownWgs },
	);
}

test.describe('Offline fallback page', () => {
	test.setTimeout(300_000);
	test.beforeEach(async ({ page }) => {
		await page.route('**/api/wg/mine', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					wgs: [
						{ code: 'MTE8PZAT', memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
						{ code: 'ABCDEFGH', memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
					],
				}),
			}),
		);
	});

	test('does not disclose stored offline data without a current account membership', async ({
		page,
	}) => {
		await page.unroute('**/api/wg/mine');
		await page.route('**/api/wg/mine', (route) => route.fulfill({ status: 401 }));
		await gotoWithRetry(page, '/offline');
		await seedOfflineState(page, [{ code: 'MTE8PZAT', name: 'sadf', lastVisitedAt: Date.now() }]);

		await expect(page.getByText('Keine wartenden Aktionen.')).toBeVisible();
		await expect(page.getByText('Milch')).toHaveCount(0);
		await expect(page.getByText('sadf')).toHaveCount(0);
	});

	test('shows remembered WGs and queued offline actions', async ({ page }) => {
		await gotoWithRetry(page, '/offline');
		await seedOfflineState(page, [{ code: 'MTE8PZAT', name: 'sadf', lastVisitedAt: Date.now() }]);

		await expect(page.getByRole('heading', { name: /offline|verbunden/i })).toBeVisible();
		await expect(page.getByText('1 Aktion wartet.')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Offline-Aktionen jetzt synchronisieren' }),
		).toBeVisible();
		await expect(page.getByText('Einkauf', { exact: true })).toBeVisible();
		await expect(page.getByText('Milch')).toBeVisible();
		await expect(page.getByRole('link', { name: /sadf/i })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Aktionen prüfen' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/einstellungen#daten',
		);
	});

	test('links the review action to the WG that has queued work', async ({ page }) => {
		await gotoWithRetry(page, '/offline');
		await seedOfflineState(page, [
			{ code: 'ABCDEFGH', name: 'Ruhige WG', lastVisitedAt: Date.now() },
			{ code: 'MTE8PZAT', name: 'sadf', lastVisitedAt: Date.now() - 1 },
		]);

		await expect(page.getByRole('link', { name: 'Aktionen prüfen' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/einstellungen#daten',
		);
	});

	test('shows review hints for risky queued actions', async ({ page }) => {
		await gotoWithRetry(page, '/offline');
		await seedOfflineState(
			page,
			[{ code: 'MTE8PZAT', name: 'sadf', lastVisitedAt: Date.now() }],
			[
				{
					id: 'shopping-update:MTE8PZAT:test',
					type: 'shopping.update',
					shareCode: 'MTE8PZAT',
					memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					createdAt: 'broken',
					payload: { itemId: 'item-1', name: 'Milch', bought: true },
				},
			],
		);

		await expect(page.getByText('Zeitpunkt unklar')).toBeVisible();
		await expect(page.getByText(/Zeitpunkt prüfen:/)).toBeVisible();
		await expect(page.getByText(/Prüfe den Eintrag vor dem erneuten Senden/)).toBeVisible();
	});

	test('summarizes queued actions hidden beyond the preview', async ({ page }) => {
		await gotoWithRetry(page, '/offline');
		await seedOfflineState(
			page,
			[{ code: 'MTE8PZAT', name: 'sadf', lastVisitedAt: Date.now() }],
			Array.from({ length: 6 }, (_, index) => ({
				id: `shopping:MTE8PZAT:${index}`,
				type: 'shopping.create',
				shareCode: 'MTE8PZAT',
				memberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
				createdAt: new Date().toISOString(),
				payload: { name: `Artikel ${index + 1}`, quantity: null },
			})),
		);

		await expect(page.getByText('6 Aktionen warten.')).toBeVisible();
		await expect(page.getByText('6 Aktionen warten', { exact: true })).toBeVisible();
		await expect(page.getByText('Artikel 4')).toBeVisible();
		await expect(page.getByText('Artikel 5')).toBeHidden();
		await expect(page.getByText(/\+2 weitere Aktionen/)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Alle Aktionen prüfen' })).toHaveAttribute(
			'href',
			'/wg/MTE8PZAT/einstellungen#daten',
		);
	});
});
