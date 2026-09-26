import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test('quick restock retry keeps its idempotency key per inventory item', async ({ page }) => {
	const firstId = '11111111-1111-4111-8111-111111111111';
	const secondId = '22222222-2222-4222-8222-222222222222';
	const initialItems = [
		{
			id: firstId,
			wgId: FIXTURE_WG.id,
			name: 'Reis',
			quantity: 5,
			unit: 'Packung',
			threshold: 1,
			category: 'kueche',
			lastDecrementedAt: '2026-09-23T10:00:00.000Z',
			decrementCount30d: 3,
			createdAt: '2026-09-20T10:00:00.000Z',
			updatedAt: '2026-09-23T10:00:00.000Z',
		},
		{
			id: secondId,
			wgId: FIXTURE_WG.id,
			name: 'Linsen',
			quantity: 2,
			unit: 'Packung',
			threshold: 1,
			category: 'kueche',
			lastDecrementedAt: '2026-09-23T10:00:00.000Z',
			decrementCount30d: 2,
			createdAt: '2026-09-20T10:00:00.000Z',
			updatedAt: '2026-09-23T10:00:00.000Z',
		},
	];
	const quantities = new Map(initialItems.map((item) => [item.id, item.quantity]));
	const keysByItem = new Map<string, string[]>();
	const committedKeyByItem = new Map<string, string>();

	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory`, async (route) => {
		if (route.request().method() !== 'GET') {
			await route.continue();
			return;
		}
		const items = initialItems.map((item) => ({ ...item, quantity: quantities.get(item.id) }));
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				items,
				grouped: { bad: [], kueche: items, putzmittel: [], sonstiges: [] },
			}),
		});
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/*`, async (route) => {
		const request = route.request();
		if (request.method() !== 'PATCH') {
			await route.continue();
			return;
		}
		const itemId = new URL(request.url()).pathname.split('/').at(-1) ?? '';
		const key = request.headers()['idempotency-key'] ?? '';
		const keys = keysByItem.get(itemId) ?? [];
		keys.push(key);
		keysByItem.set(itemId, keys);

		const item = initialItems.find((candidate) => candidate.id === itemId);
		if (!item) throw new Error(`unexpected inventory item ${itemId}`);

		if (itemId === firstId && keys.length === 1) {
			// Simulate a committed increment whose response was lost after commit.
			quantities.set(itemId, (quantities.get(itemId) ?? 0) + 1);
			committedKeyByItem.set(itemId, key);
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: '{"error":"server_error"}',
			});
			return;
		}

		if (committedKeyByItem.get(itemId) !== key) {
			quantities.set(itemId, (quantities.get(itemId) ?? 0) + 1);
			committedKeyByItem.set(itemId, key);
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ item: { ...item, quantity: quantities.get(itemId) } }),
		});
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Schnell nachfüllen' }).click();
	const drawer = page
		.locator('[data-slot="drawer-popup"]')
		.filter({ hasText: 'Schnell nachfüllen' });

	await drawer.getByRole('button', { name: 'Reis um eins erhöhen' }).click();
	await expect(drawer.getByText('Aktualisierung fehlgeschlagen.')).toBeVisible();
	await drawer.getByRole('button', { name: 'Linsen um eins erhöhen' }).click();
	await expect.poll(() => keysByItem.get(secondId)?.length).toBe(1);
	await drawer.getByRole('button', { name: 'Reis um eins erhöhen' }).click();
	await expect.poll(() => keysByItem.get(firstId)?.length).toBe(2);

	expect(keysByItem.get(firstId)?.[1]).toBe(keysByItem.get(firstId)?.[0]);
	expect(quantities.get(firstId)).toBe(6);
});

test('a deleted inventory item disappears before the refetch lands', async ({ page }) => {
	const item = {
		id: '11111111-1111-4111-8111-111111111111',
		wgId: FIXTURE_WG.id,
		name: 'Reis',
		quantity: 5,
		unit: 'Packung',
		threshold: 1,
		category: 'kueche',
		lastDecrementedAt: null,
		decrementCount30d: 0,
		createdAt: '2026-09-20T10:00:00.000Z',
		updatedAt: '2026-09-23T10:00:00.000Z',
	};
	let gets = 0;

	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory`, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		// Only the first load answers; the refetch after the delete stays in flight.
		if (++gets > 1) return;
		await route.fulfill({
			json: { items: [item], grouped: { bad: [], kueche: [item], putzmittel: [], sonstiges: [] } },
		});
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/${item.id}`, async (route) => {
		if (route.request().method() !== 'DELETE') return route.continue();
		await route.fulfill({ json: { ok: true } });
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Reis entfernen', exact: true }).click();
	await page.getByRole('button', { name: 'Reis endgültig entfernen' }).click();

	await expect.poll(() => gets).toBeGreaterThan(1);
	await expect(page.getByRole('button', { name: 'Reis um eins erhöhen' })).toHaveCount(0);
});

test('armed inventory delete can be cancelled without deleting the item', async ({ page }) => {
	const item = {
		id: '11111111-1111-4111-8111-111111111111',
		wgId: FIXTURE_WG.id,
		name: 'Reis',
		quantity: 5,
		unit: 'Packung',
		threshold: 1,
		category: 'kueche',
		lastDecrementedAt: null,
		decrementCount30d: 0,
		createdAt: '2026-09-20T10:00:00.000Z',
		updatedAt: '2026-09-23T10:00:00.000Z',
	};
	let deleteCalls = 0;

	await setupMember(page);
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory`, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		await route.fulfill({
			json: { items: [item], grouped: { bad: [], kueche: [item], putzmittel: [], sonstiges: [] } },
		});
	});
	await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/${item.id}`, async (route) => {
		if (route.request().method() !== 'DELETE') return route.continue();
		deleteCalls += 1;
		await route.fulfill({ json: { ok: true } });
	});

	await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
	await dismissOnboarding(page);
	await page.getByRole('button', { name: 'Reis entfernen', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Reis endgültig entfernen' })).toBeVisible();
	await page.getByRole('button', { name: 'Löschen von Reis abbrechen' }).click();

	await expect(page.getByRole('button', { name: 'Reis endgültig entfernen' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reis entfernen', exact: true })).toBeVisible();
	expect(deleteCalls).toBe(0);
});
