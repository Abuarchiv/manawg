// Shopping list: quick input parsing, mutation/replay safety, duplicate conflicts, hitarea and swipe.
// Why: two roommates edit the same list concurrently; duplicates and retries must resolve deterministically.

import { type Page, expect, test } from '@playwright/test';
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

test.describe('shopping conflict handling', () => {
	type FixtureShoppingItem = {
		id: string;
		addedByMemberId: string;
		name: string;
		quantity: string | null;
		boughtAt: string | null;
		boughtByMemberId: string | null;
		createdAt: string;
		updatedAt: string;
	};

	async function mockShoppingPage(
		page: Page,
		viewerIsAdmin: boolean,
		deleteStatus = 200,
		items: FixtureShoppingItem[] = [
			{
				id: 'shopping-done',
				addedByMemberId: FIXTURE_WG.memberId,
				name: 'Kaffee',
				quantity: null,
				boughtAt: '2026-09-22T12:00:00.000Z',
				boughtByMemberId: FIXTURE_WG.memberId,
				createdAt: '2026-09-22T10:00:00.000Z',
				updatedAt: '2026-09-22T12:00:00.000Z',
			},
		],
		conflictOnPatch = false,
	) {
		const { shareCode, memberId, memberName } = FIXTURE_WG;
		let getCalls = 0;
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, active: true }],
					viewerIsAdmin,
				},
			}),
		);
		await page.route(
			new RegExp(`/api/wg/${shareCode}/shopping(?:/[^/?]+)?(?:\\?.*)?$`),
			(route) => {
				const method = route.request().method();
				if (method === 'DELETE') {
					return route.fulfill({
						status: deleteStatus,
						json: deleteStatus === 200 ? { deleted: 1 } : { error: 'not_admin' },
					});
				}
				if (method === 'PATCH' && conflictOnPatch) {
					return route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } });
				}
				if (method === 'GET') getCalls += 1;
				return route.fulfill({ json: { items } });
			},
		);
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		return { getCalls: () => getCalls };
	}

	test('hides clearing bought items from non-admins', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await mockShoppingPage(page, false);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		await expect(page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' })).toHaveCount(
			0,
		);
	});

	test('keeps an item removal pending until the server answers, then clears it on failure and success', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const { shareCode, memberId } = FIXTURE_WG;
		const item: FixtureShoppingItem = {
			id: 'shopping-milk',
			addedByMemberId: memberId,
			name: 'Milch',
			quantity: null,
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-22T10:00:00.000Z',
			updatedAt: '2026-09-22T10:00:00.000Z',
		};
		// The same array feeds the mock GET: after the successful DELETE the
		// „server“ stops returning the item, like a real reload after the removal.
		const serverItems = [item];
		await mockShoppingPage(page, false, 200, serverItems);
		let deletes = 0;
		let releaseDelete: () => void = () => {};
		const deleteGate = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		await page.route(
			new RegExp(`/api/wg/${shareCode}/shopping/${item.id}(?:\\?.*)?$`),
			async (route) => {
				if (route.request().method() !== 'DELETE') return route.fallback();
				deletes += 1;
				if (deletes === 1) {
					await deleteGate;
					return route.fulfill({ status: 500, json: { error: 'server_error' } });
				}
				serverItems.length = 0;
				return route.fulfill({ json: { deleted: 1 } });
			},
		);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Artikelaktionen: Milch' }).click();
		const remove = page.getByRole('button', { name: /entfernen: Milch$/ });
		const confirmRemove = page.getByRole('button', { name: 'Endgültig entfernen: Milch' });
		// The first tap arms, the second confirms; click only once the confirm state shows.
		await remove.click();
		await confirmRemove.click();
		await expect(remove).toBeDisabled();
		releaseDelete();

		await expect(remove).toBeEnabled();
		expect(deletes).toBe(1);
		await remove.click();
		await confirmRemove.click();
		// The request counter runs in the route handler, so asynchronously to the click.
		await expect.poll(() => deletes).toBe(2);
		await expect(page.getByRole('button', { name: 'Artikelaktionen: Milch' })).toHaveCount(0);
	});

	test('explains the admin requirement when clear-bought returns 403', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		await mockShoppingPage(page, true, 403);
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		await page.getByRole('button', { name: 'Erledigte Artikel entfernen (1)' }).click();
		await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
		await expect(
			page.getByText('Nur Admins dürfen erledigte Artikel für die ganze WG entfernen.'),
		).toBeVisible();
	});

	test('refreshes the list after a duplicate add and keeps the draft values', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const shareCode = 'MTE8PZAT';
		let getCalls = 0;
		let postCalls = 0;
		await page.route(`**/api/wg/${shareCode}/shopping*`, async (route) => {
			if (route.request().method() === 'GET') {
				getCalls += 1;
				return route.fulfill({
					json: {
						items:
							getCalls > 1
								? [
										{
											id: 'shopping-existing',
											addedByMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
											name: 'Milch',
											quantity: '1 L',
											boughtAt: null,
											boughtByMemberId: null,
											createdAt: '2026-09-21T08:00:00.000Z',
											updatedAt: '2026-09-21T08:00:00.000Z',
										},
									]
								: [],
					},
				});
			}
			if (route.request().method() === 'POST') {
				postCalls += 1;
				return route.fulfill({ status: 409, json: { error: 'shopping_item_duplicate' } });
			}
			return route.continue();
		});

		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('2 L Milch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		await expect(
			page.getByText(
				'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.',
			),
		).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toContainText('Milch');
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('2 L Milch');
		expect(postCalls).toBe(1);
		expect(getCalls).toBeGreaterThanOrEqual(2);
	});

	test('adds and checks items instantly, then rolls a failed add back with a footer error', async ({
		page,
	}) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);
		const shareCode = 'MTE8PZAT';
		const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
		let releaseCreate: (() => void) | undefined;
		const createGate = new Promise<void>((resolve) => {
			releaseCreate = resolve;
		});
		let failNext = false;
		let created = false;
		const realItem = {
			id: 'shopping-real',
			addedByMemberId: memberId,
			name: 'Hafermilch',
			quantity: null,
			boughtAt: null,
			boughtByMemberId: null,
			createdAt: '2026-09-21T08:00:00.000Z',
			updatedAt: '2026-09-21T08:00:00.000Z',
		};
		await page.route(`**/api/wg/${shareCode}/shopping`, async (route) => {
			if (route.request().method() === 'GET') {
				return route.fulfill({ json: { items: created ? [realItem] : [] } });
			}
			if (route.request().method() !== 'POST') return route.continue();
			if (failNext) return route.fulfill({ status: 500, json: { error: 'internal' } });
			await createGate;
			created = true;
			return route.fulfill({ json: { item: realItem } });
		});

		await setupMember(page);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByLabel('Artikel-Name').fill('Hafermilch');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();

		// The row shows before the server answered; its checkbox is still disabled.
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toContainText('Hafermilch');
		releaseCreate?.();
		await expect(page.locator('[data-shopping-row]#shopping-shopping-real')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);

		failNext = true;
		await page.getByLabel('Artikel-Name').fill('Brot');
		await page.getByRole('button', { name: 'Artikel hinzufügen' }).click();
		await expect(page.locator('#shopping-add-error')).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('Brot');
	});

	test('reopening a bought duplicate restores both items and explains the conflict at 320px', async ({
		page,
	}) => {
		test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
		const { memberId } = FIXTURE_WG;
		const items: FixtureShoppingItem[] = [
			{
				id: '11111111-1111-4111-8111-111111111111',
				addedByMemberId: memberId,
				name: 'Milch',
				quantity: '1 L',
				boughtAt: '2026-09-22T12:00:00.000Z',
				boughtByMemberId: memberId,
				createdAt: '2026-09-22T10:00:00.000Z',
				updatedAt: '2026-09-22T12:00:00.000Z',
			},
			{
				id: '22222222-2222-4222-8222-222222222222',
				addedByMemberId: memberId,
				name: 'Milch',
				quantity: '2 L',
				boughtAt: null,
				boughtByMemberId: null,
				createdAt: '2026-09-23T10:00:00.000Z',
				updatedAt: '2026-09-23T10:00:00.000Z',
			},
		];
		const { getCalls } = await mockShoppingPage(page, true, 200, items, true);
		const conflictMessage =
			'Dieser Artikel steht bereits offen auf der Einkaufsliste. Prüfe den vorhandenen Eintrag; seine Menge bleibt unverändert.';

		await page.setViewportSize({ width: 320, height: 800 });
		await setupMember(page);
		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/einkauf`);
		await dismissOnboarding(page);
		await page.getByText('Erledigt (1)', { exact: true }).click();
		const getCallsBeforeReopen = getCalls();
		await page.getByRole('checkbox', { name: 'Milch wieder öffnen', exact: true }).click();

		await expect(page.getByText(conflictMessage, { exact: true })).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(2);
		await expect(
			page.getByRole('checkbox', { name: 'Milch wieder öffnen', exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole('checkbox', { name: 'Milch erledigen', exact: true }),
		).not.toBeChecked();
		expect(getCalls()).toBeGreaterThan(getCallsBeforeReopen);
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(page.getByText(conflictMessage, { exact: true })).toBeVisible();
	});

	test('wraps quick shopping suggestions at phone widths and large text', async ({ page }) => {
		test.skip(
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true',
			'requires the local fixture server',
		);

		const { shareCode, memberId, memberName } = FIXTURE_WG;
		await setupMember(page);
		await page.route(`**/api/wg/${shareCode}/members*`, (route) =>
			route.fulfill({
				json: {
					members: [{ id: memberId, name: memberName, active: true }],
					viewerIsAdmin: false,
				},
			}),
		);
		let shoppingPostCount = 0;
		await page.route(`**/api/wg/${shareCode}/shopping*`, (route) => {
			if (route.request().method() === 'POST') shoppingPostCount += 1;
			return route.fulfill({ json: { items: [] } });
		});
		await page.route(`**/api/wg/${shareCode}/inventory*`, (route) =>
			route.fulfill({ json: { items: [] } }),
		);
		await navigateToFeature(page, `/wg/${shareCode}/einkauf`);
		await dismissOnboarding(page);

		const suggestions = page.locator('ul[aria-label="Vorschläge"]');
		await expect(suggestions).toBeVisible();
		expect(await suggestions.locator('button').count()).toBeGreaterThan(1);
		const assertSuggestionsFit = async (
			width: number,
			colorScheme: 'light' | 'dark',
			fontSize: number,
		) => {
			await page.setViewportSize({ width, height: 812 });
			await page.emulateMedia({ colorScheme });
			await expect
				.poll(() => page.locator('html').evaluate((html) => html.classList.contains('dark')))
				.toBe(colorScheme === 'dark');
			const state = await page.evaluate(() => ({
				viewport: document.documentElement.clientWidth,
				scroll: document.documentElement.scrollWidth,
				fontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			}));
			expect(state.scroll).toBeLessThanOrEqual(state.viewport);
			expect(state.fontSize).toBe(fontSize);
			const geometry = await suggestions.evaluate((list) => {
				const bounds = list.getBoundingClientRect();
				return {
					clientWidth: list.clientWidth,
					scrollWidth: list.scrollWidth,
					left: bounds.left,
					right: bounds.right,
					items: Array.from(list.children).map((item) => {
						const rect = item.getBoundingClientRect();
						return { left: rect.left, right: rect.right };
					}),
				};
			});
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
			expect(
				geometry.items.every(
					(item) => item.left >= geometry.left - 1 && item.right <= geometry.right + 1,
				),
			).toBe(true);
		};
		for (const width of [320, 360]) {
			await page.setViewportSize({ width, height: 812 });
			const baseFontSize = await page.evaluate(() =>
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			);
			for (const colorScheme of ['light', 'dark'] as const) {
				await assertSuggestionsFit(width, colorScheme, baseFontSize);
			}
		}

		await page.route('**/__e2e-font-scale-200.css', (route) =>
			route.fulfill({ contentType: 'text/css', body: ':root { font-size: 32px !important; }' }),
		);
		await page.addStyleTag({
			url: new URL('/__e2e-font-scale-200.css', page.url()).toString(),
		});
		await page.setViewportSize({ width: 320, height: 812 });
		await page.emulateMedia({ colorScheme: 'light' });
		const suggestionButtons = suggestions.locator('button');
		const pointerTarget = suggestionButtons.nth(1);
		// Arrange the same partial overlap from the rendered geometry.
		const overlapViewportHeight = await pointerTarget.evaluate((button) => {
			const action = document.querySelector('[data-page-primary-action]');
			if (!action) throw new Error('Expected the fixed shopping action');
			const buttonRect = button.getBoundingClientRect();
			return Math.round(
				window.innerHeight +
					buttonRect.top +
					buttonRect.height / 2 -
					action.getBoundingClientRect().top,
			);
		});
		await page.setViewportSize({ width: 320, height: overlapViewportHeight });
		const pointerPoint = await pointerTarget.evaluate((button) => {
			const action = document.querySelector('[data-page-primary-action]');
			if (!action) throw new Error('Expected the fixed shopping action');
			const buttonRect = button.getBoundingClientRect();
			const actionRect = action.getBoundingClientRect();
			return {
				x: buttonRect.left + buttonRect.width / 2,
				y: Math.min(buttonRect.bottom, actionRect.top) - 2,
				buttonTop: buttonRect.top,
				buttonBottom: buttonRect.bottom,
				actionTop: actionRect.top,
			};
		});
		expect(pointerPoint.buttonBottom).toBeGreaterThan(pointerPoint.actionTop);
		const pointerHitsSuggestion = await pointerTarget.evaluate((button, point) => {
			const hit = document.elementFromPoint(point.x, point.y);
			return Boolean(hit && button.contains(hit));
		}, pointerPoint);
		expect(pointerHitsSuggestion).toBe(true);
		await page.mouse.click(pointerPoint.x, pointerPoint.y);
		await expect.poll(() => shoppingPostCount).toBe(1);
		await expect
			.poll(() => pointerTarget.evaluate((button) => button.getBoundingClientRect().top))
			.toBe(pointerPoint.buttonTop);

		await suggestionButtons.first().focus();
		for (let index = 0; index < (await suggestionButtons.count()); index += 1) {
			if (index > 0) await page.keyboard.press('Tab');
			const button = suggestionButtons.nth(index);
			await expect(button).toBeFocused();
			await expect
				.poll(
					() =>
						button.evaluate((element) => {
							const action = document.querySelector('[data-page-primary-action]');
							if (!action) throw new Error('Expected the fixed shopping action');
							return element.getBoundingClientRect().bottom - action.getBoundingClientRect().top;
						}),
					{ timeout: 3_000 },
				)
				.toBeLessThan(0);
		}
		for (const width of [320, 360]) {
			for (const colorScheme of ['light', 'dark'] as const) {
				await assertSuggestionsFit(width, colorScheme, 32);
			}
		}
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
