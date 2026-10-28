// English shopping list and supplies: rows, drawers, prompts, suggestions, forms and load errors.
// Why: Every shopping and supplies string ships in two languages; a missed one would show German chrome in English.

import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type InventoryItemDto, groupItemsByCategory } from '../src/features/inventory/inventory';
import {
	FIXTURE_WG,
	dismissOnboarding,
	mockUnreadCount,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';
import { expectNoGermanChrome, expectNoHorizontalOverflow, setEnglishLocale } from './support/i18n';

const BASE = `/api/wg/${FIXTURE_WG.shareCode}`;
const EINKAUF = `/wg/${FIXTURE_WG.shareCode}/einkauf`;
const VORRAETE = `/wg/${FIXTURE_WG.shareCode}/vorraete`;
const MINA_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';
const WIDTHS = [320, 390] as const;
const SCHEMES = ['light', 'dark'] as const;
const HOUR_MS = 60 * 60 * 1000;

function shoppingItem(overrides: Record<string, unknown>) {
	const createdAt = new Date(Date.now() - 2 * HOUR_MS).toISOString();
	return {
		id: 'item',
		name: 'Item',
		quantity: null,
		addedByMemberId: FIXTURE_WG.memberId,
		boughtAt: null,
		boughtByMemberId: null,
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function stock(overrides: Partial<InventoryItemDto>): InventoryItemDto {
	const at = '2026-10-20T10:00:00.000Z';
	return {
		id: 'stock',
		wgId: FIXTURE_WG.id,
		name: 'Stock',
		quantity: 3,
		unit: 'Stück',
		threshold: 1,
		category: 'sonstiges',
		lastDecrementedAt: null,
		decrementCount30d: 0,
		createdAt: at,
		updatedAt: at,
		...overrides,
	};
}

const SUPPLIES = [
	stock({
		id: 'soap',
		name: 'Soap',
		quantity: 0,
		unit: 'Packung',
		threshold: 2,
		category: 'bad',
		decrementCount30d: 1,
	}),
	stock({
		id: 'rice',
		name: 'Rice',
		quantity: 2,
		unit: 'Rolle',
		threshold: 1,
		category: 'kueche',
		decrementCount30d: 3,
	}),
	stock({ id: 'detergent', name: 'Detergent', quantity: 1.5, unit: 'L', category: 'putzmittel' }),
];

async function mockInventory(page: Page, items: InventoryItemDto[]): Promise<void> {
	await page.route(`**${BASE}/inventory`, (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ json: { items, grouped: groupItemsByCategory(items) } })
			: route.fallback(),
	);
}

async function mockShopping(page: Page, items: unknown[]): Promise<void> {
	await page.route(`**${BASE}/shopping`, (route) =>
		route.request().method() === 'GET' ? route.fulfill({ json: { items } }) : route.fallback(),
	);
}

async function prepare(
	page: Page,
	context: BrowserContext,
	baseURL: string | undefined,
	width: number,
	colorScheme: 'light' | 'dark',
): Promise<void> {
	await setEnglishLocale(context, baseURL ?? 'http://localhost:3101');
	await setupMember(page);
	await mockUnreadCount(page, BASE);
	await page.setViewportSize({ width, height: 780 });
	await page.emulateMedia({ colorScheme });
}

async function expectNoSidewaysScroll(page: Page, width: number): Promise<void> {
	if (width === 320) return expectNoHorizontalOverflow(page);
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}));
	expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test.describe('English shopping list', () => {
	skipUnlessFixtures();

	for (const width of WIDTHS) {
		for (const scheme of SCHEMES) {
			const where = `${width}px ${scheme}`;

			test(`list, rows, drawer and prompts ${where}`, async ({ page, context, baseURL }) => {
				await prepare(page, context, baseURL, width, scheme);
				const justNow = new Date(Date.now() - 5 * 60 * 1000).toISOString();
				await mockShopping(page, [
					shoppingItem({ id: 'milk', name: 'Milk', quantity: '2' }),
					shoppingItem({ id: 'rice', name: 'Rice', addedByMemberId: MINA_ID }),
					shoppingItem({
						id: 'coffee',
						name: 'Coffee',
						addedByMemberId: MINA_ID,
						boughtAt: justNow,
						boughtByMemberId: MINA_ID,
					}),
					shoppingItem({
						id: 'bread',
						name: 'Bread',
						boughtAt: justNow,
						boughtByMemberId: FIXTURE_WG.memberId,
					}),
				]);
				await mockInventory(page, [
					SUPPLIES[0] as InventoryItemDto,
					stock({
						id: 'bread-stock',
						name: 'Bread',
						quantity: 0,
						unit: 'Stück',
						threshold: 2,
						category: 'kueche',
					}),
				]);
				await navigateToFeature(page, EINKAUF);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page).toHaveTitle(/Shopping/);
				await expect(page.getByRole('heading', { name: 'Shopping', level: 1 })).toBeAttached();
				await expect(page.getByText('2 open')).toBeAttached();
				const list = page.getByRole('region', { name: 'Shopping items' });
				await expect(list.getByText('2 · Added by you')).toBeVisible();
				await expect(list.getByText('Added by Mina')).toBeVisible();
				await expect(page.getByText('Running low', { exact: true }).first()).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add Soap' })).toBeVisible();
				await expect(page.getByPlaceholder('e.g. 2 rice')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeDisabled();
				await expect(page.getByRole('checkbox', { name: 'Mark Milk as done' })).toBeVisible();
				await expect(page.getByText('Record 1 item as an expense?')).toBeVisible();
				await expect(page.getByRole('link', { name: 'Record expense' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Not now' }).first()).toBeVisible();
				await expect(page.getByText('Bought Bread. Increase stock by 3 pcs?')).toBeVisible();
				await expect(page.getByRole('button', { name: 'Bread: increase stock' })).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);

				await page.getByText('Done (2)').click();
				await expect(list.getByText('Bought by Mina')).toBeVisible();
				await expect(list.getByText('Bought by you')).toBeVisible();
				await expectNoGermanChrome(page);

				await page.getByRole('button', { name: 'Item actions: Milk' }).click();
				const drawer = page.getByRole('dialog');
				await expect(drawer.getByText('2 · Added by you')).toBeVisible();
				await expect(drawer.getByRole('button', { name: 'Edit' })).toBeVisible();
				await expect(drawer.getByRole('button', { name: 'Remove item' })).toBeVisible();
				await expect(drawer.getByRole('button', { name: 'Close' })).toBeVisible();
				await drawer.getByRole('button', { name: 'Edit' }).click();
				await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('Milk');
				await expect(drawer.getByLabel('Quantity (optional)')).toHaveValue('2');
				await expect(drawer.getByRole('button', { name: 'Save' })).toBeVisible();
				await expect(drawer.getByRole('button', { name: 'Cancel' })).toBeVisible();
				await expectNoGermanChrome(page);
				await drawer.getByRole('button', { name: 'Cancel' }).click();
				await drawer.getByRole('button', { name: 'Remove item' }).click();
				await expect(
					drawer.getByText('“Milk” will be removed permanently. This cannot be undone.'),
				).toBeVisible();
				await expect(
					drawer.getByRole('button', { name: 'Remove permanently: Milk' }),
				).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);
			});
		}
	}

	test('done item drawer offers the expense and the clear dialog is English', async ({
		page,
		context,
		baseURL,
	}) => {
		await prepare(page, context, baseURL, 390, 'light');
		const bought = new Date(Date.now() - 30 * HOUR_MS).toISOString();
		await mockShopping(page, [
			shoppingItem({
				id: 'coffee',
				name: 'Coffee',
				boughtAt: bought,
				boughtByMemberId: MINA_ID,
			}),
			shoppingItem({ id: 'tea', name: 'Tea', boughtAt: bought, boughtByMemberId: null }),
		]);
		await mockInventory(page, []);
		await page.route(`**${BASE}/members`, (route) =>
			route.request().method() === 'GET'
				? route.fulfill({
						json: {
							members: [
								{ id: FIXTURE_WG.memberId, name: FIXTURE_WG.memberName, active: true },
								{ id: MINA_ID, name: 'Mina', active: true },
							],
							viewerIsAdmin: true,
						},
					})
				: route.fallback(),
		);
		await navigateToFeature(page, EINKAUF);
		await dismissOnboarding(page);

		await expect(page.getByText('Everything has been bought.')).toBeVisible();
		await page.getByText('Done (2)').click();
		await expect(page.getByText('Bought', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Item actions: Coffee' }).click();
		const drawer = page.getByRole('dialog');
		await expect(drawer.getByText('Added by you · Bought by Mina')).toBeVisible();
		await expect(drawer.getByRole('link', { name: 'Add as expense' })).toBeVisible();
		await expect(drawer.getByText('You check the amount and split before saving.')).toBeVisible();
		await expect(
			drawer.getByText('Only the person who added the item or a flat admin can remove it.'),
		).toHaveCount(0);
		await expectNoGermanChrome(page);
		await drawer.getByRole('button', { name: 'Close' }).click();

		const clear = page.getByRole('button', { name: 'Remove done items (2)' });
		await expect(clear).toBeVisible();
		await clear.click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('Remove done items?')).toBeVisible();
		await expect(
			dialog.getByText('2 done items are permanently removed for the whole flat. Open items stay.'),
		).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('an empty list, staples, a failed add and a failed load are English', async ({
		page,
		context,
		baseURL,
	}) => {
		await prepare(page, context, baseURL, 390, 'light');
		await mockShopping(page, []);
		await mockInventory(page, []);
		await page.route(`**${BASE}/shopping`, (route) => {
			const method = route.request().method();
			if (method === 'GET') return route.fulfill({ json: { items: [] } });
			return route.fulfill({ status: 500, json: { error: 'server_error' } });
		});
		await navigateToFeature(page, EINKAUF);
		await dismissOnboarding(page);

		await expect(page.getByText('Nothing on the list yet')).toBeVisible();
		await expect(page.getByText('Write an item below or tap a suggestion.')).toBeVisible();
		await expect(page.getByText('Suggestions', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add Toilet paper' })).toBeVisible();
		await expectNoGermanChrome(page);

		await page.getByPlaceholder('e.g. 2 rice').fill('2 oat milk');
		await page.getByRole('button', { name: 'Add item', exact: true }).click();
		await expect(
			page.getByText(
				'Could not be added. Check the list to see whether the item is already there, then try again.',
			),
		).toBeVisible();
		await expectNoGermanChrome(page);

		await page.unroute(`**${BASE}/shopping`);
		await page.route(`**${BASE}/shopping`, (route) =>
			route.fulfill({ status: 500, json: { error: 'server_error' } }),
		);
		await page.reload();
		await dismissOnboarding(page);
		await expect(
			page.getByText('Shopping list could not be loaded: Try again in a moment.'),
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reload list' })).toBeVisible();
		await expectNoGermanChrome(page);
		await expectNoSidewaysScroll(page, 390);
	});

	test('the route error boundary is English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await mockInventory(page, []);
		// A reply the page cannot parse makes the list throw while rendering.
		await page.route(`**${BASE}/shopping`, (route) => route.fulfill({ json: { items: 'broken' } }));
		await navigateToFeature(page, EINKAUF);
		await expect(
			page.getByRole('heading', { name: 'Shopping could not load right now' }),
		).toBeVisible();
		await expect(page.getByText('Something went wrong on the shopping list.')).toBeVisible();
		await expectNoGermanChrome(page);
	});
});

test.describe('English supplies', () => {
	skipUnlessFixtures();

	for (const width of WIDTHS) {
		for (const scheme of SCHEMES) {
			const where = `${width}px ${scheme}`;

			test(`groups, rows, form and quick restock ${where}`, async ({ page, context, baseURL }) => {
				await prepare(page, context, baseURL, width, scheme);
				await mockInventory(page, SUPPLIES);
				await navigateToFeature(page, VORRAETE);
				await dismissOnboarding(page);

				await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
				await expect(page).toHaveTitle(/Supplies/);
				await expect(page.getByRole('heading', { name: 'Supplies', level: 1 })).toBeAttached();
				await expect(page.getByText('3 items in stock')).toBeAttached();
				await expect(page.getByRole('heading', { name: 'Running low (1)' })).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Kitchen (1)' })).toBeVisible();
				await expect(page.getByRole('heading', { name: 'Cleaning supplies (1)' })).toBeVisible();
				await expect(page.getByText(/0 packs · Restock at\s2/)).toBeVisible();
				await expect(page.getByText(/2 rolls · Restock at\s1/)).toBeVisible();
				await expect(page.getByText(/1\.5 L · Restock at\s1/)).toBeVisible();
				await expect(page.getByRole('link', { name: 'Open shopping list' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Quick restock' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Decrease Rice by one' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Increase Rice by one' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Edit Rice' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Remove Rice' })).toBeVisible();
				await expect(
					page.getByRole('button', { name: 'Decrease Soap by one (stock 0)' }),
				).toBeVisible();
				await expectNoGermanChrome(page);
				await expectNoSidewaysScroll(page, width);

				await page.getByRole('button', { name: 'Remove Rice' }).click();
				await expect(page.getByRole('button', { name: 'Remove permanently: Rice' })).toBeVisible();
				await expect(page.getByRole('button', { name: 'Cancel: remove Rice' })).toBeVisible();
				await page.getByRole('button', { name: 'Cancel: remove Rice' }).click();

				await page.getByRole('button', { name: 'Quick restock' }).click();
				const sheet = page.getByRole('dialog');
				await expect(sheet.getByText('Items running low first, then the most used')).toBeVisible();
				await expect(sheet.getByText(/2 rolls · 3× in the last 30 days/)).toBeVisible();
				await expect(sheet.getByRole('button', { name: 'Increase Soap by 3 packs' })).toBeVisible();
				await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
				await expectNoGermanChrome(page);
				await sheet.getByRole('button', { name: 'Close' }).click();

				await page.getByRole('button', { name: 'Edit Detergent' }).click();
				const form = page.getByRole('dialog');
				await expect(form.getByText('Edit item')).toBeVisible();
				await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Detergent');
				await expect(form.getByLabel('Quantity')).toHaveValue('1.5');
				await expect(form.getByLabel('Restock at')).toHaveValue('1');
				await expect(form.getByLabel('Unit')).toHaveValue('L');
				await expect(form.getByLabel('Category')).toHaveValue('putzmittel');
				await expect(
					form.getByText('The item goes onto the shopping list once stock reaches this level.'),
				).toBeVisible();
				await expectNoGermanChrome(page);
				await form.getByLabel('Name', { exact: true }).fill('Detergent XL');
				await form.getByRole('button', { name: 'Cancel' }).click();
				const discard = page.getByRole('alertdialog');
				await expect(discard.getByText('Discard changes?')).toBeVisible();
				await expect(discard.getByText('Your changes have not been saved yet.')).toBeVisible();
				await expect(discard.getByRole('button', { name: 'Keep editing' })).toBeVisible();
				await discard.getByRole('button', { name: 'Discard' }).click();
				await expectNoSidewaysScroll(page, width);
			});
		}
	}

	test('the new item form lists English units and takes decimals with a point', async ({
		page,
		context,
		baseURL,
	}) => {
		await prepare(page, context, baseURL, 390, 'light');
		await mockInventory(page, SUPPLIES);
		await navigateToFeature(page, VORRAETE);
		await dismissOnboarding(page);

		await page.getByRole('button', { name: 'Add item' }).click();
		const form = page.getByRole('dialog');
		await expect(form.getByText('New item')).toBeVisible();
		await expect(form.getByPlaceholder('e.g. Pasta')).toBeVisible();
		await expect(form.getByLabel('Unit').getByRole('option', { name: 'pcs' })).toBeAttached();
		await expect(form.getByLabel('Unit').getByRole('option', { name: 'roll' })).toBeAttached();
		await expect(form.getByLabel('Unit').getByRole('option', { name: 'pack' })).toBeAttached();
		await expect(
			form.getByLabel('Category').getByRole('option', { name: 'Bathroom' }),
		).toBeAttached();
		await expect(
			form.getByLabel('Category').getByRole('option', { name: 'Cleaning supplies' }),
		).toBeAttached();

		await form.getByLabel('Quantity').fill('2,555');
		await expect(form.getByLabel('Quantity')).toHaveValue('2.55');
		await form.getByLabel('Name', { exact: true }).fill('rice');
		await form.getByRole('button', { name: 'Save' }).click();
		await expect(form.getByText('Already exists: Rice (2 rolls)')).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('the route error boundary is English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await page.route(`**${BASE}/inventory`, (route) =>
			route.fulfill({ json: { items: 'broken' } }),
		);
		await navigateToFeature(page, VORRAETE);
		await expect(
			page.getByRole('heading', { name: 'Supplies could not load right now' }),
		).toBeVisible();
		await expect(page.getByText('Something went wrong in supplies.')).toBeVisible();
		await expectNoGermanChrome(page);
	});

	test('an empty list and a failed load are English', async ({ page, context, baseURL }) => {
		await prepare(page, context, baseURL, 390, 'light');
		await mockInventory(page, []);
		await navigateToFeature(page, VORRAETE);
		await dismissOnboarding(page);
		await expect(page.getByText('No supplies recorded yet')).toBeVisible();
		await expect(
			page.getByText(
				'When an item drops below its limit, it is added to the shopping list automatically.',
			),
		).toBeVisible();
		await expectNoGermanChrome(page);

		await page.unroute(`**${BASE}/inventory`);
		await page.route(`**${BASE}/inventory`, (route) =>
			route.fulfill({ status: 500, json: { error: 'server_error' } }),
		);
		await page.reload();
		await dismissOnboarding(page);
		await expect(
			page.getByText('Supplies could not be loaded: Try again in a moment.'),
		).toBeVisible();
		await expect(page.getByText('Currently unavailable')).toBeAttached();
		await expect(page.getByRole('button', { name: 'Reload supplies' })).toBeVisible();
		await expectNoGermanChrome(page);
		await expectNoSidewaysScroll(page, 390);
	});
});
