// Inventory: consume, restock and save with replay/CAS semantics.
// Why: stock counts are shared state; a retry or concurrent save must not double-apply.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import {
	idempotencyResponses,
	shoppingItems,
	wgInventoryItems,
	wgInventoryLog,
} from '../src/core/db';
import type { WgInventoryItem } from '../src/core/db/schema';
import type { DbTransaction } from '../src/core/db/transaction';
import { type ReplaySlotDependencies, claimReplaySlot } from '../src/core/guards/replay-slot';
import {
	type ConsumeInventoryMutationInput,
	consumeInventoryMutation,
} from '../src/features/inventory/consume-mutation';
import { type InventoryItemDto, groupItemsByCategory } from '../src/features/inventory/inventory';
import * as inventoryMutations from '../src/features/inventory/inventory-mutations';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('inventory consume regression', () => {
	type InventoryState = {
		item: WgInventoryItem;
		logs: Array<Record<string, unknown>>;
		shopping: Array<{ id: string; name: string; boughtAt: Date | null }>;
		updateCount: number;
	};

	const mutationInput: ConsumeInventoryMutationInput = {
		itemId: '11111111-1111-4111-8111-111111111111',
		wgId: '22222222-2222-4222-8222-222222222222',
		memberId: '33333333-3333-4333-8333-333333333333',
		delta: -1,
	};

	function createState(): InventoryState {
		const now = new Date('2026-01-01T00:00:00.000Z');
		return {
			item: {
				id: mutationInput.itemId,
				wgId: mutationInput.wgId,
				name: 'Toilettenpapier',
				quantity: 5,
				unit: 'Rolle',
				threshold: 4,
				category: 'bad',
				lastDecrementedAt: null,
				createdAt: now,
				updatedAt: now,
			},
			logs: [],
			shopping: [],
			updateCount: 0,
		};
	}

	function createFakeTransaction(state: InventoryState): DbTransaction {
		const select = (..._fields: unknown[]) => {
			let table: unknown;
			const query = {
				from(nextTable: unknown) {
					table = nextTable;
					return query;
				},
				where() {
					return query;
				},
				limit() {
					const rows = Promise.resolve(table === wgInventoryItems ? [state.item] : []);
					return Object.assign(rows, { for: () => rows });
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; this fake mirrors that contract.
				then<TResult1 = { id: string; name: string }[], TResult2 = never>(
					onFulfilled?:
						| ((value: { id: string; name: string }[]) => TResult1 | PromiseLike<TResult1>)
						| null,
					onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
				): PromiseLike<TResult1 | TResult2> {
					return Promise.resolve(table === shoppingItems ? state.shopping : []).then(
						onFulfilled,
						onRejected,
					);
				},
			};
			return query;
		};

		const update = (table: unknown) => {
			let values: Partial<WgInventoryItem> = {};
			const query = {
				set(nextValues: Partial<WgInventoryItem>) {
					values = nextValues;
					return query;
				},
				where() {
					return query;
				},
				returning() {
					if (table !== wgInventoryItems) return Promise.resolve([]);
					state.item = { ...state.item, ...values };
					state.updateCount += 1;
					return Promise.resolve([state.item]);
				},
			};
			return query;
		};

		const insert = (table: unknown) => {
			let values: Record<string, unknown> = {};
			const nextId = `shopping-${state.shopping.length + 1}`;
			const execute = () => {
				if (table === wgInventoryLog) {
					state.logs.push({ ...values });
					return [];
				}
				if (table !== shoppingItems) return [];
				const name = String(values.name ?? '');
				const duplicate = state.shopping.some(
					(item) =>
						item.boughtAt === null && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
				);
				if (duplicate) return [];
				state.shopping.push({ id: nextId, name, boughtAt: null });
				return [{ id: nextId }];
			};
			const query = {
				values(nextValues: Record<string, unknown>) {
					values = nextValues;
					return query;
				},
				onConflictDoNothing() {
					return query;
				},
				returning() {
					return Promise.resolve(execute());
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; this fake mirrors that contract.
				then<TResult1 = unknown, TResult2 = never>(
					onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
					onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
				): PromiseLike<TResult1 | TResult2> {
					return Promise.resolve(execute()).then(onFulfilled, onRejected);
				},
			};
			return query;
		};

		return { select, update, insert } as unknown as DbTransaction;
	}

	type ReplayBody = { quantity: number };

	async function mutateIfWinner(
		dependencies: ReplaySlotDependencies<ReplayBody>,
		state: InventoryState,
		cache: { value: ReplayBody | null },
	) {
		const slot = await claimReplaySlot('inventory-consume', 'same-key', dependencies);
		if (!slot.won) return slot;
		const result = await consumeInventoryMutation(createFakeTransaction(state), mutationInput);
		if (result.kind !== 'ok') throw new Error(result.kind);
		const body = { quantity: result.updated.quantity };
		cache.value = body;
		return { won: true as const, body };
	}

	test('inventory consume replays one mutation and preserves failure safety', async () => {
		const state = createState();
		const cache: { value: ReplayBody | null } = { value: null };
		let claimed = false;
		const dependencies: ReplaySlotDependencies<ReplayBody> = {
			claim: async () => {
				if (claimed) return false;
				claimed = true;
				return true;
			},
			read: async () => cache.value,
			sleep: async () => undefined,
		};

		await expect(mutateIfWinner(dependencies, state, cache)).resolves.toEqual({
			won: true,
			body: { quantity: 4 },
		});
		await expect(mutateIfWinner(dependencies, state, cache)).resolves.toEqual({
			won: false,
			cached: { quantity: 4 },
		});

		expect(state.item.quantity).toBe(4);
		expect(state.updateCount).toBe(1);
		expect(state.logs).toHaveLength(1);
		expect(state.logs[0]).toMatchObject({ delta: -1, kind: 'consume' });
		expect(state.shopping).toHaveLength(1);
	});
});

test.describe('inventory restock retry', () => {
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

	test('inventory create, update, and delete survive a stale in-flight refresh', async ({
		page,
	}) => {
		const itemId = '11111111-1111-4111-8111-111111111111';
		const createdItemId = '22222222-2222-4222-8222-222222222222';
		const deletedItemId = '33333333-3333-4333-8333-333333333333';
		const initialItem: InventoryItemDto = {
			id: itemId,
			wgId: FIXTURE_WG.id,
			name: 'Reis',
			quantity: 5,
			unit: 'Packung',
			threshold: 1,
			category: 'kueche',
			lastDecrementedAt: '2026-09-23T10:00:00.000Z',
			decrementCount30d: 4,
			createdAt: '2026-09-20T10:00:00.000Z',
			updatedAt: '2026-09-23T10:00:00.000Z',
		};
		const deletedItem: InventoryItemDto = { ...initialItem, id: deletedItemId, name: 'Milch' };
		let items = [initialItem, deletedItem];
		let delayNextGet = false;
		let releaseStaleGet = () => {};
		let markStaleGetStarted = () => {};
		const staleGetStarted = new Promise<void>((resolve) => {
			markStaleGetStarted = resolve;
		});
		const staleGetGate = new Promise<void>((resolve) => {
			releaseStaleGet = resolve;
		});
		const inventoryUrl = `**/api/wg/${FIXTURE_WG.shareCode}/inventory`;

		await setupMember(page);
		await page.route(inventoryUrl, async (route) => {
			const request = route.request();
			if (request.method() === 'GET') {
				const snapshot = items.map((item) => ({ ...item }));
				if (delayNextGet) {
					delayNextGet = false;
					markStaleGetStarted();
					await staleGetGate;
				}
				await route.fulfill({
					json: { items: snapshot, grouped: groupItemsByCategory(snapshot) },
				});
				return;
			}

			if (request.method() === 'POST') {
				const body = request.postDataJSON() as Omit<
					InventoryItemDto,
					'id' | 'wgId' | 'lastDecrementedAt' | 'decrementCount30d' | 'createdAt' | 'updatedAt'
				>;
				const item: InventoryItemDto = {
					...body,
					id: createdItemId,
					wgId: FIXTURE_WG.id,
					lastDecrementedAt: null,
					decrementCount30d: 0,
					createdAt: '2026-09-27T10:00:00.000Z',
					updatedAt: '2026-09-27T10:00:00.000Z',
				};
				items = [...items, item];
				const responseItem = { ...item, decrementCount30d: undefined };
				await route.fulfill({ json: { item: responseItem } });
				return;
			}

			await route.continue();
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/*`, async (route) => {
			const request = route.request();
			const requestItemId = new URL(request.url()).pathname.split('/').at(-1);
			if (request.method() === 'PATCH') {
				const current = items.find((item) => item.id === requestItemId);
				if (!current) throw new Error(`unexpected inventory item ${requestItemId}`);
				const body = request.postDataJSON() as { quantityDelta: number };
				const item = {
					...current,
					quantity: current.quantity + body.quantityDelta,
					updatedAt: '2026-09-27T10:01:00.000Z',
				};
				items = items.map((candidate) => (candidate.id === item.id ? item : candidate));
				const responseItem = { ...item, decrementCount30d: undefined };
				await route.fulfill({ json: { item: responseItem } });
				return;
			}

			if (request.method() === 'DELETE') {
				items = items.filter((item) => item.id !== requestItemId);
				await route.fulfill({ json: { ok: true } });
				return;
			}

			await route.continue();
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
		await dismissOnboarding(page);
		await expect(page.getByRole('button', { name: 'Reis um eins erhöhen' })).toBeVisible();
		delayNextGet = true;
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await staleGetStarted;

		try {
			await page.getByRole('button', { name: 'Reis um eins erhöhen' }).click();
			await expect(page.getByText('6 Packung · Nachkaufen ab 1')).toBeVisible();

			await page.getByRole('button', { name: 'Vorrat hinzufügen' }).click();
			await page.locator('#inventory-name').fill('Seife');
			await page.locator('#inventory-qty').fill('2');
			await page.getByRole('button', { name: 'Speichern', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Seife um eins erhöhen' })).toBeVisible();

			await page.getByRole('button', { name: 'Milch entfernen', exact: true }).click();
			await page.getByRole('button', { name: 'Endgültig entfernen: Milch' }).click();
			await expect(page.getByRole('button', { name: 'Milch um eins erhöhen' })).toHaveCount(0);

			const staleResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/api/wg/${FIXTURE_WG.shareCode}/inventory`) &&
					response.request().method() === 'GET',
			);
			releaseStaleGet();
			const response = await staleResponse;
			await response.finished();
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);

			await expect(page.getByRole('button', { name: 'Seife um eins erhöhen' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Reis um eins erhöhen' })).toBeVisible();
			await expect(page.getByText('6 Packung · Nachkaufen ab 1')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Milch um eins erhöhen' })).toHaveCount(0);

			await page.getByRole('button', { name: 'Schnell nachfüllen' }).click();
			const restockSheet = page
				.locator('[data-slot="drawer-popup"]')
				.filter({ hasText: 'Schnell nachfüllen' });
			await expect(restockSheet.getByText('4× in 30 Tagen')).toBeVisible();
		} finally {
			releaseStaleGet();
		}
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
				json: {
					items: [item],
					grouped: { bad: [], kueche: [item], putzmittel: [], sonstiges: [] },
				},
			});
		});
		await page.route(`**/api/wg/${FIXTURE_WG.shareCode}/inventory/${item.id}`, async (route) => {
			if (route.request().method() !== 'DELETE') return route.continue();
			await route.fulfill({ json: { ok: true } });
		});

		await navigateToFeature(page, `/wg/${FIXTURE_WG.shareCode}/vorraete`);
		await dismissOnboarding(page);
		await page.getByRole('button', { name: 'Reis entfernen', exact: true }).click();
		await page.getByRole('button', { name: 'Endgültig entfernen: Reis' }).click();

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
				json: {
					items: [item],
					grouped: { bad: [], kueche: [item], putzmittel: [], sonstiges: [] },
				},
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
		await expect(page.getByRole('button', { name: 'Endgültig entfernen: Reis' })).toBeVisible();
		await page.getByRole('button', { name: 'Abbrechen: Löschen von Reis' }).click();

		await expect(page.getByRole('button', { name: 'Endgültig entfernen: Reis' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Reis entfernen', exact: true })).toBeVisible();
		expect(deleteCalls).toBe(0);
	});
});

test.describe('inventory save regression', () => {
	const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));

	type State = {
		items: WgInventoryItem[];
		logs: Array<Record<string, unknown>>;
		shopping: Array<{ id: string; name: string; boughtAt: Date | null }>;
		updateCount: number;
		replay: { responseBody: Record<string, unknown>; expiresAt: Date } | null;
	};

	const mutationInput = {
		wgId: '22222222-2222-4222-8222-222222222222',
		memberId: '33333333-3333-4333-8333-333333333333',
		name: 'Toilettenpapier',
		quantity: 0,
		unit: 'Rolle',
		threshold: 1,
		category: 'bad',
	};

	function createState(quantity = 5): State {
		const now = new Date('2026-01-01T00:00:00.000Z');
		return {
			items: [
				{
					id: '11111111-1111-4111-8111-111111111111',
					wgId: mutationInput.wgId,
					name: mutationInput.name,
					quantity,
					unit: mutationInput.unit,
					threshold: 4,
					category: mutationInput.category,
					lastDecrementedAt: null,
					createdAt: now,
					updatedAt: now,
				},
			],
			logs: [],
			shopping: [],
			updateCount: 0,
			replay: null,
		};
	}

	function onlyItem(state: State): WgInventoryItem {
		const item = state.items[0];
		if (!item) throw new Error('expected an inventory item in test state');
		return item;
	}

	function createFakeTransaction(state: State) {
		const select = () => {
			let table: unknown;
			const query = {
				from(nextTable: unknown) {
					table = nextTable;
					return query;
				},
				where() {
					return query;
				},
				limit() {
					return Promise.resolve(table === wgInventoryItems ? state.items.slice(0, 1) : []);
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; this fake mirrors that contract.
				then<TResult1 = unknown, TResult2 = never>(
					onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
					onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
				): PromiseLike<TResult1 | TResult2> {
					return Promise.resolve(table === shoppingItems ? state.shopping : []).then(
						onFulfilled,
						onRejected,
					);
				},
			};
			return query;
		};

		const update = (table: unknown) => {
			let values: Record<string, unknown> = {};
			const query = {
				set(nextValues: Record<string, unknown>) {
					values = nextValues;
					return query;
				},
				where() {
					return query;
				},
				returning() {
					if (table === idempotencyResponses) {
						if (!state.replay || !('_claimed' in state.replay.responseBody)) {
							return Promise.resolve([]);
						}
						state.replay = {
							responseBody: values.responseBody as Record<string, unknown>,
							expiresAt: values.expiresAt as Date,
						};
						return Promise.resolve([{ scope: 'test-scope' }]);
					}
					if (table !== wgInventoryItems) return Promise.resolve([]);
					const current = state.items[0];
					if (!current) return Promise.resolve([]);
					const updated = { ...current, ...values } as WgInventoryItem;
					state.items[0] = updated;
					state.updateCount += 1;
					return Promise.resolve([updated]);
				},
			};
			return query;
		};

		const insert = (table: unknown) => {
			let values: Record<string, unknown> = {};
			const execute = () => {
				if (table === wgInventoryItems) {
					const now = new Date('2026-01-02T00:00:00.000Z');
					const item = {
						id: `created-${state.items.length}`,
						lastDecrementedAt: null,
						createdAt: now,
						updatedAt: now,
						...values,
					} as WgInventoryItem;
					state.items.push(item);
					return [item];
				}
				if (table === wgInventoryLog) {
					state.logs.push(values);
					return [];
				}
				if (table !== shoppingItems) return [];
				const name = String(values.name ?? '');
				const duplicate = state.shopping.some(
					(item) =>
						item.boughtAt === null && item.name.trim().toLowerCase() === name.trim().toLowerCase(),
				);
				if (duplicate) return [];
				const item = { id: `shopping-${state.shopping.length + 1}`, name, boughtAt: null };
				state.shopping.push(item);
				return [item];
			};
			const query = {
				values(nextValues: Record<string, unknown>) {
					values = nextValues;
					return query;
				},
				onConflictDoNothing() {
					return query;
				},
				returning() {
					return Promise.resolve(execute());
				},
				// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; this fake mirrors that contract.
				then<TResult1 = unknown, TResult2 = never>(
					onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
					onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
				): PromiseLike<TResult1 | TResult2> {
					return Promise.resolve(execute()).then(onFulfilled, onRejected);
				},
			};
			return query;
		};

		return { select, update, insert } as unknown as DbTransaction;
	}

	test('creating a below-threshold inventory item adds one open shopping item', async () => {
		const createMutation = Reflect.get(inventoryMutations, 'createInventoryItemMutation');
		expect(typeof createMutation).toBe('function');
		if (typeof createMutation !== 'function') return;

		const state = createState(0);
		const tx = createFakeTransaction(state);
		await createMutation(tx, mutationInput);
		await createMutation(tx, mutationInput);

		expect(state.items).toHaveLength(3);
		expect(state.shopping).toEqual([{ id: 'shopping-1', name: 'Toilettenpapier', boughtAt: null }]);
	});

	test('updating inventory below threshold records quantity history and queues shopping once', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		expect(typeof updateMutation).toBe('function');
		if (typeof updateMutation !== 'function') return;

		const state = createState();
		const tx = createFakeTransaction(state);
		const item = onlyItem(state);
		const expectedUpdatedAt = item.updatedAt.toISOString();
		await updateMutation(tx, {
			itemId: item.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			quantity: 4,
			expectedQuantity: 5,
			expectedUpdatedAt,
		});
		const updated = onlyItem(state);
		await updateMutation(tx, {
			itemId: updated.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			quantity: 3,
			expectedQuantity: 4,
			expectedUpdatedAt: updated.updatedAt.toISOString(),
		});

		expect(onlyItem(state).quantity).toBe(3);
		expect(state.logs).toHaveLength(2);
		expect(state.logs.map((log) => log.delta)).toEqual([-1, -1]);
		expect(state.shopping).toHaveLength(1);
	});

	test('stale absolute inventory quantity updates are rejected', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		expect(typeof updateMutation).toBe('function');
		if (typeof updateMutation !== 'function') return;

		const state = createState();
		const item = onlyItem(state);
		const staleUpdatedAt = item.updatedAt.toISOString();
		item.updatedAt = new Date('2026-01-01T00:01:00.000Z');
		item.quantity = 4;
		const result = await updateMutation(createFakeTransaction(state), {
			itemId: item.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			quantity: 9,
			expectedQuantity: 5,
			expectedUpdatedAt: staleUpdatedAt,
		});

		expect(result).toMatchObject({ kind: 'conflict' });
		expect(state.updateCount).toBe(0);
		expect(state.logs).toHaveLength(0);
	});

	test('absolute quantity compare-and-swap catches a changed quantity in the same timestamp millisecond', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		expect(typeof updateMutation).toBe('function');
		if (typeof updateMutation !== 'function') return;

		const state = createState();
		const item = onlyItem(state);
		const expectedUpdatedAt = item.updatedAt.toISOString();
		item.quantity = 4;
		const result = await updateMutation(createFakeTransaction(state), {
			itemId: item.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			quantity: 9,
			expectedQuantity: 5,
			expectedUpdatedAt,
		});

		expect(result).toMatchObject({ kind: 'conflict' });
		expect(state.updateCount).toBe(0);
		expect(onlyItem(state).quantity).toBe(4);
	});

	test('inventory replay completion replaces its claim in the mutation transaction', async () => {
		const completeReplay = Reflect.get(inventoryMutations, 'completeInventoryReplay');
		expect(typeof completeReplay).toBe('function');
		if (typeof completeReplay !== 'function') return;

		const state = createState(0);
		state.replay = {
			responseBody: { _claimed: true },
			expiresAt: new Date('2026-01-01T00:15:00Z'),
		};
		const tx = createFakeTransaction(state);
		const result = await Reflect.get(inventoryMutations, 'createInventoryItemMutation')(
			tx,
			mutationInput,
		);
		const replay = { status: 200, body: { item: result.item } };
		await completeReplay(tx, 'inventory-create:test-member', 'request-key', replay);

		expect(state.items).toHaveLength(2);
		expect(state.replay?.responseBody).toEqual(replay);
		expect(state.replay?.expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	test('inventory replay completion failure rejects the mutation transaction callback', async () => {
		const completeReplay = Reflect.get(inventoryMutations, 'completeInventoryReplay');
		expect(typeof completeReplay).toBe('function');
		if (typeof completeReplay !== 'function') return;

		await expect(
			completeReplay(
				createFakeTransaction(createState()),
				'inventory-create:test-member',
				'request-key',
				{
					status: 200,
					body: { item: { id: 'item-1' } },
				},
			),
		).rejects.toThrow('inventory_replay_completion_failed');
	});

	test('consume warning persists only on the matching completed replay row', async () => {
		const file = path.join(process.cwd(), 'src/features/inventory/inventory-mutations.ts');
		const source = transpileModule(readFileSync(file, 'utf8'), {
			compilerOptions: {
				module: ModuleKind.CommonJS,
				target: ScriptTarget.ES2022,
				esModuleInterop: true,
			},
		}).outputText;
		const module = { exports: {} as typeof inventoryMutations };
		const dialect = new PgDialect();
		const item = { id: 'inventory-1', name: 'Milk' };
		const body: { item: typeof item; warning: string | null } = { item, warning: null };
		const db = {
			update: () => ({
				set: (values: { responseBody: SQL }) => ({
					where: (condition: SQL) => ({
						returning: async () => {
							const update = dialect.sqlToQuery(values.responseBody);
							const guard = dialect.sqlToQuery(condition);
							expect(update.sql).toContain('jsonb_set');
							expect(guard.sql).toContain("->'item'->>'id'");
							expect(guard.sql).toContain("->'warning' = 'null'::jsonb");
							if (guard.params[3] !== item.id) return [];
							body.warning = update.params[0] as string;
							return [{ scope: guard.params[0] }];
						},
					}),
				}),
			}),
		};
		new Function('require', 'module', 'exports', source)(
			(name: string) =>
				name === '@/core/db'
					? { db, idempotencyResponses }
					: name === '@/features/inventory/inventory'
						? {}
						: requireFromWeb(name),
			module,
			module.exports,
		);
		const persist = module.exports.persistInventoryReplayWarning;
		expect(
			await persist(
				'inventory-consume:wg:member:inventory-1',
				'key',
				item.id,
				'notification_delivery_failed',
			),
		).toBe(true);
		expect(body).toEqual({ item, warning: 'notification_delivery_failed' });
		expect(
			await persist(
				'inventory-consume:wg:member:inventory-1',
				'key',
				'other-item',
				'notification_delivery_unknown',
			),
		).toBe(false);
	});
});
