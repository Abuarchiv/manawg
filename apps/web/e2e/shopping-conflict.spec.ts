// Shopping duplicate conflict handling.
// Why: Two roommates edit the same list concurrently; duplicates must resolve deterministically.

import { expect, type Page, test } from '@playwright/test';
import {
	dismissOnboarding,
	FIXTURE_WG,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

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
		skipUnlessFixtures();
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
		skipUnlessFixtures();
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
		skipUnlessFixtures();
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
		skipUnlessFixtures();
		const shareCode = FIXTURE_WG.shareCode;
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
											addedByMemberId: FIXTURE_WG.memberId,
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

		await expect(page.getByText('„Milch“ steht schon offen auf der Liste.')).toBeVisible();
		await expect(page.locator('[data-shopping-row]')).toHaveCount(1);
		await expect(page.locator('[data-shopping-row]')).toContainText('Milch');
		await expect(page.getByLabel('Artikel-Name')).toHaveValue('2 L Milch');
		expect(postCalls).toBe(1);
		expect(getCalls).toBeGreaterThanOrEqual(2);
	});

	test('adds and checks items instantly, then rolls a failed add back with a footer error', async ({
		page,
	}) => {
		skipUnlessFixtures();
		const shareCode = FIXTURE_WG.shareCode;
		const memberId = FIXTURE_WG.memberId;
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
		skipUnlessFixtures();
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
		const conflictMessage = '„Milch“ steht schon offen auf der Liste.';

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
		skipUnlessFixtures();

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
