import { expect, test } from '@playwright/test';
import { shoppingItems } from '../src/core/db';
import type { ShoppingItem } from '../src/core/db/schema';
import type { DbTransaction } from '../src/core/db/transaction';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';
import {
	SHOPPING_CREATE_DUPLICATE_RESPONSE,
	type ShoppingCreateInput,
	type ShoppingCreateReplayResponse,
	insertShoppingItem,
	normalizeShoppingCreateReplayResponse,
	shoppingCreateCodec,
	shoppingCreateHttpResponse,
	withShoppingCreatePostCommitFallback,
} from '../src/features/shopping/server/shopping-mutation';
import {
	FIXTURE_WG,
	dismissOnboarding,
	navigateToFeature,
	setupMember,
	skipUnlessFixtures,
} from './support/helpers';

test.describe('shopping input', () => {
	test('splits a leading amount from the item name', () => {
		expect(parseShoppingInput('2 Hafermilch')).toEqual({ name: 'Hafermilch', quantity: '2' });
		expect(parseShoppingInput(' 1,5 L  Milch ')).toEqual({ name: 'Milch', quantity: '1,5 L' });
		expect(parseShoppingInput('3x Brot')).toEqual({ name: 'Brot', quantity: '3x' });
		expect(parseShoppingInput('1 Packung Kaffee')).toEqual({
			name: 'Kaffee',
			quantity: '1 Packung',
		});
		expect(parseShoppingInput('7Up')).toEqual({ name: '7Up', quantity: null });
		expect(parseShoppingInput('Milch')).toEqual({ name: 'Milch', quantity: null });
		expect(parseShoppingInput('2')).toEqual({ name: '2', quantity: null });
	});
});

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
		skipUnlessFixtures();
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
			page.getByText(
				'Konnte nicht hinzugefügt werden. Prüfe kurz die Liste, ob der Artikel schon drin ist, und versuche es noch einmal.',
			),
		).toBeVisible();
		await page.getByRole('button', { name: 'Artikel hinzufügen', exact: true }).click();
		await expect.poll(() => keys.length).toBe(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[1]).toBe(keys[0]);
	});

	test('queues a second Enter while the first add is saving and ignores a repeated Enter on the same text', async ({
		page,
	}) => {
		skipUnlessFixtures();
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
		skipUnlessFixtures();
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

// Claim, rollback release and same-key duplicate replay run through withIdempotentWrite and are
// covered by tests/idempotent-write.test.ts and the shopping route replay tests.
test.describe('shopping mutation regression', () => {
	const item: ShoppingItem = {
		id: 'shopping-1',
		wgId: '11111111-1111-4111-8111-111111111111',
		addedByMemberId: '22222222-2222-4222-8222-222222222222',
		name: 'Kaffee',
		normalizedName: 'kaffee',
		quantity: null,
		boughtAt: null,
		boughtByMemberId: null,
		createdAt: new Date('2026-09-23T10:00:00.000Z'),
		updatedAt: new Date('2026-09-23T10:00:00.000Z'),
	};

	const input: ShoppingCreateInput = {
		wgId: item.wgId,
		addedByMemberId: item.addedByMemberId,
		name: item.name,
		quantity: null,
		bought: false,
	};

	function createTransaction(returnItem = true) {
		const state = { insertCount: 0 };
		const tx = {
			insert: (table: unknown) => {
				if (table !== shoppingItems) throw new Error('unexpected table');
				return {
					values: () => ({
						returning: async () => {
							state.insertCount += 1;
							return returnItem ? [item] : [];
						},
					}),
				};
			},
		} as unknown as DbTransaction;
		return { state, tx };
	}

	test('shopping create inserts exactly one item in the given transaction', async () => {
		const { state, tx } = createTransaction();
		await expect(insertShoppingItem(tx, input)).resolves.toEqual(item);
		expect(state.insertCount).toBe(1);
		const empty = createTransaction(false);
		await expect(insertShoppingItem(empty.tx, input)).resolves.toBe(undefined);
	});

	test('replays legacy successful shopping cache rows during the response-envelope rollout', () => {
		const legacyItem = JSON.parse(JSON.stringify(item));
		expect(
			normalizeShoppingCreateReplayResponse({
				item: legacyItem,
				warning: null,
			}),
		).toEqual({
			status: 200,
			body: { item: legacyItem, warning: null },
		});
		expect(normalizeShoppingCreateReplayResponse({ status: 201, body: {} })).toBeNull();
		expect(shoppingCreateCodec.decode({ status: 201, body: {} })).toBeNull();
	});

	test('rejects malformed cached shopping success instead of replaying it as a saved item', () => {
		const serializedItem = JSON.parse(JSON.stringify(item));
		for (const malformedItem of [
			null,
			'shopping-1',
			{ id: 'shopping-1' },
			{ ...serializedItem, createdAt: null },
		]) {
			expect(
				normalizeShoppingCreateReplayResponse({
					status: 200,
					body: { item: malformedItem, warning: null },
				}),
			).toBeNull();
			expect(
				normalizeShoppingCreateReplayResponse({ item: malformedItem, warning: null }),
			).toBeNull();
		}
	});

	test('same-key duplicate responses are stored and replay as 409', async () => {
		const stored = shoppingCreateCodec.encode(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		expect(stored).toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		const replay = shoppingCreateCodec.decode(stored);
		expect(replay).toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		const httpResponse = shoppingCreateHttpResponse(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		expect(httpResponse.status).toBe(409);
		await expect(httpResponse.json()).resolves.toEqual({ error: 'shopping_item_duplicate' });
	});

	test('post-commit side-effect failure returns the durable response', async () => {
		const provisional: ShoppingCreateReplayResponse = {
			status: 200,
			body: { item, warning: 'notification_delivery_unknown' },
		};
		let sanitizedFailureLogs = 0;
		const owner = await withShoppingCreatePostCommitFallback(
			provisional,
			async () => {
				throw new Error('private notification payload must not be logged');
			},
			() => {
				sanitizedFailureLogs += 1;
			},
		);
		const ownerResponse = shoppingCreateHttpResponse(owner);
		expect(ownerResponse.status).toBe(200);
		expect(owner).toEqual(provisional);
		expect(sanitizedFailureLogs).toBe(1);
	});
});
