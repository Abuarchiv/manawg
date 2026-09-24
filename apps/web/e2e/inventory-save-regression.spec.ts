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
import * as inventoryMutations from '../src/features/inventory/inventory-mutations';

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
	state.replay = { responseBody: { _claimed: true }, expiresAt: new Date('2026-01-01T00:15:00Z') };
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

test('consume warning persists on the completed replay row without replacing its item or expiry', async () => {
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
	const expiresAt = new Date(Date.now() + 60_000);
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
	expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	expect(
		await persist(
			'inventory-consume:wg:member:inventory-1',
			'key',
			'other-item',
			'notification_delivery_unknown',
		),
	).toBe(false);
});
