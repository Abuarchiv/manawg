// Shopping list: member-only API data, retry keys, checkbox hit areas, swipe pointer capture and the
// household list UI.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('shopping retry', () => {
	test.setTimeout(240_000);

	test('requires a WG member for shopping API data', async ({ request }) => {
		const response = await request.get('/api/wg/MTE8PZAT/shopping', {
			timeout: 120_000,
		});

		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
	});

	test('retries an uncertain shopping create with the same idempotency key', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const keys: string[] = [];
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			keys.push(route.request().headers()['idempotency-key'] ?? '');
			await route.fulfill({
				status: keys.length === 1 ? 503 : 200,
				contentType: 'application/json',
				body: JSON.stringify(
					keys.length === 1
						? { error: 'idempotency_response_pending' }
						: {
								item: {
									id: 'replayed-shopping-item',
									name: 'Rettich',
									quantity: null,
									addedByMemberId: 'fixture-member',
									boughtAt: null,
									boughtByMemberId: null,
									createdAt: new Date().toISOString(),
								},
								warning: null,
							},
				),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('Rettich');
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect(
			page.getByText('Speicherstatus unklar. Prüfe die Liste und versuche es bei Bedarf erneut.'),
		).toBeVisible();
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect.poll(() => keys.length).toBe(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBe(keys[0]);
	});

	test('queues a second Enter while the first add is saving and ignores a repeated Enter on the same text', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const posted: string[] = [];
		let releaseFirst: () => void = () => {};
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.fallback();
				return;
			}
			const { name } = route.request().postDataJSON() as { name: string };
			posted.push(name);
			if (posted.length === 1) await firstGate;
			await route.fulfill({
				json: {
					item: {
						id: `item-${posted.length}`,
						name,
						quantity: null,
						addedByMemberId: FIXTURE_WG.memberId,
						boughtAt: null,
						boughtByMemberId: null,
						createdAt: new Date().toISOString(),
					},
					warning: null,
				},
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		const input = page.getByLabel('Artikel-Name');
		await input.fill('Milch');
		await input.press('Enter');
		// The second Enter must not fail on the disabled submit button.
		await input.press('Enter');
		await input.fill('Brot');
		await input.press('Enter');
		// The waiting „Brot“ is not queued twice either.
		await input.press('Enter');
		releaseFirst();
		await expect.poll(() => posted).toEqual(['Milch', 'Brot']);
		await expect(input).toHaveValue('');
		expect(posted).toEqual(['Milch', 'Brot']);
	});

	test('uses a fresh idempotency key after an offline-queued shopping create', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'POST') {
				await route.continue();
				return;
			}
			await route.abort('internetdisconnected');
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);
		const readQueuedKeys = () =>
			page.evaluate(() => {
				const raw = window.localStorage.getItem('manawg:offline-actions');
				const actions = raw
					? (JSON.parse(raw) as Array<{ type: string; idempotencyKey?: string }>)
					: [];
				return actions
					.filter((action) => action.type === 'shopping.create')
					.map((action) => action.idempotencyKey);
			});
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await page.getByLabel('Artikel-Name').fill('Rettich');
			await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
			await expect.poll(async () => (await readQueuedKeys()).length).toBe(attempt + 1);
		}
		const keys = await readQueuedKeys();
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBeTruthy();
		expect(keys[1]).not.toBe(keys[0]);
	});
});

test.describe('haushalt shopping checkbox hitarea', () => {
	// Regression for a <44px touch target: ShoppingItemRow's checkbox grows its hit
	// area with an invisible `after:-inset-2.5` pseudo-element, but the swipe-to-toggle
	// row wraps everything in an <li> with `overflow-hidden`. Since the checkbox sits
	// flush against the row's left edge (Item uses px-0), overflow-hidden would clip any
	// leftward hit-area extension to an effective ~34px target, so `overflow-hidden` only
	// applies while a swipe is in progress.
	test('shopping item checkbox keeps its full hit area when not swiping', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'hitarea-item',
							name: 'Milch',
							quantity: null,
							addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);

		const checkbox = page.getByRole('checkbox', { name: 'Milch erledigen' });
		await expect(checkbox).toBeVisible();

		const li = page.locator('li:has(> :has([aria-label="Milch erledigen"]))').first();
		const overflow = await li.evaluate((el) => getComputedStyle(el).overflow);
		expect(overflow).not.toBe('hidden');

		// A point 5px to the left of the checkbox's own box sits inside the invisible
		// after:-inset-2.5 hit area (10px). It must still resolve to the checkbox, not
		// get clipped by an ancestor.
		const box = await checkbox.boundingBox();
		if (!box) throw new Error('checkbox has no bounding box');
		const hitTarget = await page.evaluate(
			({ x, y }) => {
				const el = document.elementFromPoint(x, y);
				return el?.closest('[data-slot="checkbox"]') !== null;
			},
			{ x: Math.max(0, box.x - 5), y: box.y + box.height / 2 },
		);
		expect(hitTarget).toBe(true);
	});
});

test.describe('haushalt shopping swipe pointer capture', () => {
	// ShoppingItemRow drives its swipe-to-toggle gesture with raw pointer events. Unlike touch
	// events, pointer events retarget to whatever element sits under the finger, so a fast or
	// diagonal swipe that drifts off the row would never fire onPointerUp (which resets swipeX
	// and completes the toggle) and leave the row stuck mid-swipe. setPointerCapture on
	// pointerdown keeps move/up on the row for the whole gesture, like touch events.
	test('shopping row captures the pointer when a touch swipe starts', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await page.route('**/api/wg/MTE8PZAT/shopping', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [
						{
							id: 'capture-item',
							name: 'Milch',
							quantity: null,
							addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, '/wg/MTE8PZAT/einkauf');
		await dismissOnboarding(page);

		const row = page.locator('[data-shopping-row]').first();
		await expect(row).toBeVisible();

		const capturedPointerId = await row.evaluate((el) => {
			let seen: number | null = null;
			const original = el.setPointerCapture.bind(el);
			el.setPointerCapture = (pointerId: number) => {
				seen = pointerId;
				return original(pointerId);
			};
			const box = el.getBoundingClientRect();
			el.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					pointerId: 7,
					pointerType: 'touch',
					clientX: box.x + 10,
					clientY: box.y + box.height / 2,
				}),
			);
			return seen;
		});

		expect(capturedPointerId).toBe(7);
	});
});

test.describe('household list UI', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const shareCode = FIXTURE_WG.shareCode;
	const memberId = FIXTURE_WG.memberId;

	test('shopping remove button names the item and the armed confirm state', async ({ page }) => {
		const itemName = 'Milch';
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/shopping`, (route) =>
			route.fulfill({
				json: {
					items: [
						{
							id: 'sh-1',
							addedByMemberId: memberId,
							name: itemName,
							quantity: null,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
					members: { [memberId]: { name: FIXTURE_WG.memberName, color: null } },
				},
			}),
		);

		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: `Artikelaktionen: ${itemName}` }).click();
		const drawer = page.getByRole('dialog');
		await drawer.getByRole('button', { name: `Artikel entfernen: ${itemName}` }).click();
		// WCAG 2.5.3 — the visible "Milch" label must stay in the accessible name,
		// and the armed (confirm) state must be named distinctly from the initial one.
		await expect(
			drawer.getByRole('button', { name: `Endgültig entfernen: ${itemName}` }),
		).toBeVisible();
	});

	test('inventory + button applies the PATCH response without waiting for a follow-up refetch', async ({
		page,
	}) => {
		const items = [
			{
				id: 'inv-1',
				wgId: FIXTURE_WG.id,
				name: 'Spülmittel',
				quantity: 5,
				unit: 'Stück',
				threshold: 1,
				category: 'putzmittel',
				decrementCount30d: 0,
				lastDecrementedAt: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		];
		await setupMember(page);
		let getCount = 0;
		await page.route(`**/api/wg/${shareCode}/inventory`, async (route) => {
			getCount += 1;
			if (getCount > 1) {
				// The background re-sync fired after the mutation. Make it slow so a
				// regression that goes back to waiting on this GET (instead of the
				// PATCH response) would fail this test.
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
			return route.fulfill({ json: { items } });
		});
		await page.route(`**/api/wg/${shareCode}/inventory/inv-1`, (route) => {
			if (route.request().method() !== 'PATCH') return route.fallback();
			const updated = { ...items[0], quantity: 6 };
			return route.fulfill({ json: { item: updated } });
		});

		await navigateToFeature(page, `/wg/${shareCode}/vorraete`);
		await dismissOnboarding(page);
		const row = page.locator('[data-slot="item"]', { hasText: 'Spülmittel' });
		await row.getByRole('button', { name: 'Spülmittel um eins erhöhen' }).click();
		await expect(row).toContainText('6 Stück', { timeout: 600 });
	});
});
