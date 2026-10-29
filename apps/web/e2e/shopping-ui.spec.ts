import { expect, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('shopping checkbox hitarea', () => {
	// Regression for a <44px touch target: ShoppingItemRow's checkbox grows its hit
	// area with an invisible `after:-inset-2.5` pseudo-element, but the swipe-to-toggle
	// row wraps everything in an <li> with `overflow-hidden`. Since the checkbox sits
	// flush against the row's left edge (Item uses px-0), overflow-hidden would clip any
	// leftward hit-area extension to an effective ~34px target, so `overflow-hidden` only
	// applies while a swipe is in progress.
	test('shopping item checkbox keeps its full hit area when not swiping', async ({ page }) => {
		skipUnlessFixtures();
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
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
							addedByMemberId: FIXTURE_WG.memberId,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
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

test.describe('shopping swipe pointer capture', () => {
	// ShoppingItemRow drives its swipe-to-toggle gesture with raw pointer events. Unlike touch
	// events, pointer events retarget to whatever element sits under the finger, so a fast or
	// diagonal swipe that drifts off the row would never fire onPointerUp (which resets swipeX
	// and completes the toggle) and leave the row stuck mid-swipe. setPointerCapture on
	// pointerdown keeps move/up on the row for the whole gesture, like touch events.
	test('shopping row captures the pointer when a touch swipe starts', async ({ page }) => {
		skipUnlessFixtures();
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/shopping`, async (route) => {
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
							addedByMemberId: FIXTURE_WG.memberId,
							boughtAt: null,
							boughtByMemberId: null,
							createdAt: new Date().toISOString(),
						},
					],
				}),
			});
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/shopping`);
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
	skipUnlessFixtures();

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

		await navigateToFeature(page, `/wg/${shareCode}/shopping`);
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
				unit: 'piece',
				threshold: 1,
				category: 'cleaning',
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

		await navigateToFeature(page, `/wg/${shareCode}/supplies`);
		await dismissOnboarding(page);
		const row = page.locator('[data-slot="item"]', { hasText: 'Spülmittel' });
		await row.getByRole('button', { name: 'Spülmittel um eins erhöhen' }).click();
		await expect(row).toContainText('6 Stück', { timeout: 600 });
	});
});
