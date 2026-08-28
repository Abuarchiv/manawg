import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

const ENCODED = encodeURIComponent(FIXTURE_WG.shareCode);

interface InventoryItem {
	id: string;
	wgId: string;
	name: string;
	quantity: number;
	unit: string;
	threshold: number;
	category: string;
	lastDecrementedAt: string | null;
	decrementCount30d: number;
	createdAt: string;
	updatedAt: string;
}

interface ShoppingItem {
	id: string;
	name: string;
	quantity: string | null;
	addedByMemberId: string;
	boughtByMemberId: string | null;
	boughtAt: string | null;
	createdAt: string;
}

function buildItem(overrides: Partial<InventoryItem>): InventoryItem {
	const now = new Date().toISOString();
	return {
		id: 'inv-1',
		wgId: FIXTURE_WG.id,
		name: 'Klopapier',
		quantity: 4,
		unit: 'Stück',
		threshold: 2,
		category: 'haushalt',
		lastDecrementedAt: null,
		decrementCount30d: 0,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function inventoryResponse(items: InventoryItem[]): {
	items: InventoryItem[];
	grouped: Record<string, InventoryItem[]>;
} {
	const grouped: Record<string, InventoryItem[]> = {
		haushalt: [],
		hygiene: [],
		lebensmittel: [],
		getraenke: [],
		sonstiges: [],
	};
	for (const item of items) {
		const bucket = grouped[item.category] ?? grouped.sonstiges;
		bucket.push(item);
	}
	return { items, grouped };
}

test.describe('Vorräte happy path', () => {
	test.setTimeout(180_000);

	test('adds Klopapier, decrements below threshold and auto-pushes to Einkauf', async ({
		page,
	}) => {
		await setupMember(page);

		let item: InventoryItem | null = null;
		const shopping: ShoppingItem[] = [];

		// Inventory collection endpoint (GET list, POST create).
		await page.route(`**/api/wg/${ENCODED}/inventory`, async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(inventoryResponse(item ? [item] : [])),
				});
				return;
			}
			if (request.method() === 'POST') {
				const payload = JSON.parse(request.postData() ?? '{}');
				item = buildItem({
					id: 'inv-klopapier',
					name: payload.name,
					quantity: payload.quantity,
					unit: payload.unit,
					threshold: payload.threshold,
					category: payload.category,
				});
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ item }),
				});
				return;
			}
			await route.fallback();
		});

		// Inventory consume endpoint (decrement). Crosses threshold => triggers auto-push.
		await page.route(`**/api/wg/${ENCODED}/inventory/*/consume`, async (route) => {
			if (route.request().method() !== 'POST') return route.fallback();
			if (!item) {
				await route.fulfill({
					status: 404,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'item_not_found' }),
				});
				return;
			}
			const payload = JSON.parse(route.request().postData() ?? '{}');
			const delta = Number(payload.delta ?? 0);
			const previous = item.quantity;
			const next = Math.max(0, previous + delta);
			item = {
				...item,
				quantity: next,
				lastDecrementedAt: new Date().toISOString(),
				decrementCount30d: item.decrementCount30d + 1,
			};
			// Server-side rule: when quantity crosses below threshold, push to shopping.
			const crossedBelow = previous >= item.threshold && next < item.threshold;
			if (crossedBelow && !shopping.some((row) => row.name === item?.name)) {
				shopping.push({
					id: `shop-${shopping.length + 1}`,
					name: item.name,
					quantity: null,
					addedByMemberId: FIXTURE_WG.memberId,
					boughtByMemberId: null,
					boughtAt: null,
					createdAt: new Date().toISOString(),
				});
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ item, clamped: false }),
			});
		});

		// Shopping list endpoint — used when we navigate to /einkauf for verification.
		await page.route(`**/api/wg/${ENCODED}/shopping`, async (route) => {
			if (route.request().method() !== 'GET') return route.fallback();
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: shopping }),
			});
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
		await dismissOnboarding(page);

		await expect(page.getByRole('heading', { name: 'Vorräte' })).toBeVisible({
			timeout: 30_000,
		});

		// Empty state — open create modal.
		await page.getByRole('button', { name: 'Ersten Vorrat anlegen' }).click();

		// Fill the create form: name="Klopapier", quantity=4, threshold=2.
		const nameInput = page.getByLabel('Name');
		await expect(nameInput).toBeVisible({ timeout: 10_000 });
		await nameInput.fill('Klopapier');
		await page.getByLabel('Menge').fill('4');
		await page.getByLabel('Schwelle').fill('2');
		await page.getByRole('button', { name: 'Speichern' }).first().click();

		// Item appears in the list.
		await expect(page.getByText('Klopapier')).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText('4 Stück · Schwelle 2')).toBeVisible();

		// Decrement twice (4 -> 3 -> 2). Crossing below threshold happens at 1, so
		// click three times to ensure auto-push fires. The user prompt says "twice"
		// but with a threshold of 2 and quantity 4 the server rule fires when
		// quantity < threshold (i.e. <2). Two decrements yield quantity=2 which is
		// still at-threshold. We follow the actual server behaviour and click until
		// the low-stock badge appears, which is the deterministic "triggered"
		// signal users actually see.
		const decrement = page.getByRole('button', { name: 'Klopapier um eins verringern' });
		await decrement.click();
		await expect(page.getByText('3 Stück · Schwelle 2')).toBeVisible({ timeout: 5_000 });
		await decrement.click();
		await expect(page.getByText('2 Stück · Schwelle 2')).toBeVisible({ timeout: 5_000 });
		await decrement.click();
		await expect(page.getByText('1 Stück · Schwelle 2')).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('niedrig')).toBeVisible({ timeout: 5_000 });

		// Navigate to Einkauf and confirm Klopapier appears.
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await expect(page.getByText('Klopapier')).toBeVisible({ timeout: 10_000 });
	});
});
