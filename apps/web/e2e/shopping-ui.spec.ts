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

		// The tick svg is decorative: the checkbox role already exposes the checked state.
		const indicator = checkbox.locator('[data-slot="checkbox-indicator"]');
		await expect(indicator).toHaveAttribute('aria-hidden', 'true');
		await expect(indicator.locator('title')).toHaveCount(0);

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
	test('locks shopping edit fields while saving and preserves them for a retry after failure', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const { shareCode, memberId } = FIXTURE_WG;
		let item = {
			id: 'shopping-edit-pending',
			name: 'Milch',
			quantity: '1 Packung',
			addedByMemberId: memberId,
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-10-01T10:00:00.000Z',
			updatedAt: '2026-10-01T10:00:00.000Z',
		};
		const response = Promise.withResolvers<void>();
		let patchCalls = 0;
		let submitted: unknown;
		await page.route(`**/api/wg/${shareCode}/shopping`, (route) =>
			route.fulfill({ json: { items: [item] } }),
		);
		await page.route(`**/api/wg/${shareCode}/shopping/${item.id}`, async (route) => {
			patchCalls += 1;
			submitted = route.request().postDataJSON();
			if (patchCalls === 1) {
				await response.promise;
				return route.fulfill({ status: 503, json: { error: 'unexpected_error' } });
			}
			item = { ...item, name: 'Hafermilch', quantity: '2 Packungen' };
			return route.fulfill({ json: { item } });
		});
		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/shopping`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
		await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
		const form = page.getByRole('dialog').locator('form');
		const name = form.getByLabel('Name', { exact: true });
		const quantity = form.getByLabel('Menge (optional)', { exact: true });
		await name.fill('Hafermilch');
		await quantity.fill('2 Packungen');
		try {
			await form.getByRole('button', { name: 'Speichern', exact: true }).click();
			await expect(name).toBeDisabled();
			await expect(quantity).toBeDisabled();
			await expect(form).toHaveAttribute('aria-busy', 'true');
			await expect(form.getByRole('button', { name: 'Speichert…' })).toBeDisabled();
		} finally {
			response.resolve();
		}
		await expect(name).toBeEnabled();
		await expect(quantity).toBeEnabled();
		await expect(name).toHaveValue('Hafermilch');
		await expect(quantity).toHaveValue('2 Packungen');
		await expect(form.getByRole('alert')).toBeVisible();
		await form.getByRole('button', { name: 'Speichern', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByRole('button', { name: 'Artikelaktionen: Hafermilch' })).toBeVisible();
		expect(patchCalls).toBe(2);
		expect(submitted).toMatchObject({ name: 'Hafermilch', quantity: '2 Packungen' });
	});

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
