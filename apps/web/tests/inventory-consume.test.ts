// Inventory consume and save regressions.
// Why: Stock changes must be exact and replay-safe.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
	idempotencyResponses,
	shoppingItems,
	wgInventoryItems,
	wgInventoryLog,
} from '../src/core/db';
import type { WgInventoryItem } from '../src/core/db/schema-inventory';
import type { DbTransaction } from '../src/core/db/transaction';
import { claimReplaySlot, type ReplaySlotDependencies } from '../src/core/guards/replay-slot';
import {
	type ConsumeInventoryMutationInput,
	consumeInventoryMutation,
} from '../src/features/inventory/server/consume-mutation';
import * as inventoryMutations from '../src/features/inventory/server/inventory-mutations';

describe('inventory consume regression', () => {
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
		locale: 'de',
	};

	function createState(): InventoryState {
		const now = new Date('2026-01-01T00:00:00.000Z');
		return {
			item: {
				id: mutationInput.itemId,
				wgId: mutationInput.wgId,
				name: 'Toilettenpapier',
				quantity: 5,
				unit: 'roll',
				threshold: 4,
				category: 'bathroom',
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

		assert.deepEqual(await mutateIfWinner(dependencies, state, cache), {
			won: true,
			body: { quantity: 4 },
		});
		assert.deepEqual(await mutateIfWinner(dependencies, state, cache), {
			won: false,
			cached: { quantity: 4 },
		});

		assert.equal(state.item.quantity, 4);
		assert.equal(state.updateCount, 1);
		assert.equal(state.logs.length, 1);
		assert.partialDeepStrictEqual(state.logs[0], { delta: -1, kind: 'consume' });
		assert.equal(state.shopping.length, 1);
	});
});

describe('inventory save regression', () => {
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
		unit: 'roll',
		threshold: 1,
		category: 'bathroom',
		locale: 'de' as const,
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
		assert.equal(typeof createMutation, 'function');
		if (typeof createMutation !== 'function') return;

		const state = createState(0);
		const tx = createFakeTransaction(state);
		await createMutation(tx, mutationInput);
		await createMutation(tx, mutationInput);

		assert.equal(state.items.length, 3);
		assert.deepEqual(state.shopping, [
			{ id: 'shopping-1', name: 'Toilettenpapier', boughtAt: null },
		]);
	});

	test('updating inventory below threshold records quantity history and queues shopping once', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		assert.equal(typeof updateMutation, 'function');
		if (typeof updateMutation !== 'function') return;

		const state = createState();
		const tx = createFakeTransaction(state);
		const item = onlyItem(state);
		const expectedUpdatedAt = item.updatedAt.toISOString();
		await updateMutation(tx, {
			itemId: item.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			locale: mutationInput.locale,
			quantity: 4,
			expectedQuantity: 5,
			expectedUpdatedAt,
		});
		const updated = onlyItem(state);
		await updateMutation(tx, {
			itemId: updated.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			locale: mutationInput.locale,
			quantity: 3,
			expectedQuantity: 4,
			expectedUpdatedAt: updated.updatedAt.toISOString(),
		});

		assert.equal(onlyItem(state).quantity, 3);
		assert.equal(state.logs.length, 2);
		assert.deepEqual(
			state.logs.map((log) => log.delta),
			[-1, -1],
		);
		assert.equal(state.shopping.length, 1);
	});

	test('stale absolute inventory quantity updates are rejected', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		assert.equal(typeof updateMutation, 'function');
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
			locale: mutationInput.locale,
			quantity: 9,
			expectedQuantity: 5,
			expectedUpdatedAt: staleUpdatedAt,
		});

		assert.partialDeepStrictEqual(result, { kind: 'conflict' });
		assert.equal(state.updateCount, 0);
		assert.equal(state.logs.length, 0);
	});

	test('absolute quantity compare-and-swap catches a changed quantity in the same timestamp millisecond', async () => {
		const updateMutation = Reflect.get(inventoryMutations, 'updateInventoryItemMutation');
		assert.equal(typeof updateMutation, 'function');
		if (typeof updateMutation !== 'function') return;

		const state = createState();
		const item = onlyItem(state);
		const expectedUpdatedAt = item.updatedAt.toISOString();
		item.quantity = 4;
		const result = await updateMutation(createFakeTransaction(state), {
			itemId: item.id,
			wgId: mutationInput.wgId,
			memberId: mutationInput.memberId,
			locale: mutationInput.locale,
			quantity: 9,
			expectedQuantity: 5,
			expectedUpdatedAt,
		});

		assert.partialDeepStrictEqual(result, { kind: 'conflict' });
		assert.equal(state.updateCount, 0);
		assert.equal(onlyItem(state).quantity, 4);
	});
});
