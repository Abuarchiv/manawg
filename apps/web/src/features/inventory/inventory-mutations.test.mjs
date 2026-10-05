import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { loadClaimedResponse } from '../../../tests/support/claimed-response.mjs';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const directory = path.dirname(fileURLToPath(import.meta.url));
const updatedAt = new Date('2026-09-29T10:00:00.000Z');

function loadRealInventory() {
	const source = transpileModule(readFileSync(path.join(directory, 'inventory.ts'), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(requireFromWeb, module, module.exports);
	return module.exports;
}

function loadMutations({ inventory } = {}) {
	const wgInventoryItems = { id: 'id', wgId: 'wgId', quantity: 'quantity', updatedAt: 'updatedAt' };
	const source = transpileModule(
		readFileSync(path.join(directory, 'inventory-mutations.ts'), 'utf8'),
		{ compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
	).outputText;
	const module = { exports: {} };
	const overrides = {
		'@/core/db': {
			db: {},
			idempotencyResponses: {},
			shoppingItems: {},
			wgInventoryItems,
			wgInventoryLog: { name: 'log' },
		},
		'@/core/db/transaction-abort': { TransactionAbort: class extends Error {} },
		'@/features/inventory/inventory': inventory ?? {
			buildShoppingPushPayload: () => ({}),
			clampQuantity: (value) => Math.min(Math.max(value, 0), 9999),
			isBelowThreshold: () => false,
		},
		'drizzle-orm': {
			and: (...parts) => parts,
			eq: (column, value) => [column, value],
			gt: () => null,
			sql: () => null,
		},
	};
	overrides['@/core/db/claimed-response'] = loadClaimedResponse(overrides);
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

/**
 * Another tap committed quantity 5 -> 6 after this transaction started: a
 * plain read still sees the stale 5, a locking read waits and sees the 6.
 */
function concurrentTapTx() {
	const row = { id: 'item-1', wgId: 'wg-1', quantity: 6, threshold: 0, updatedAt };
	const state = { locked: false, logs: [] };
	const tx = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						const stale = Promise.resolve([{ ...row, quantity: 5 }]);
						return Object.assign(stale, {
							for: (mode) => {
								assert.equal(mode, 'update');
								state.locked = true;
								return Promise.resolve([{ ...row }]);
							},
						});
					},
				}),
			}),
		}),
		update: () => ({
			set: (updates) => ({
				where: (conditions) => ({
					returning: async () => {
						const matches = conditions.every(
							(condition) => !Array.isArray(condition) || row[condition[0]] === condition[1],
						);
						if (!matches) return [];
						Object.assign(row, updates);
						return [{ ...row }];
					},
				}),
			}),
		}),
		insert: () => ({
			values: async (value) => {
				state.logs.push(value);
			},
		}),
	};
	return { tx, row, state };
}

test('a concurrent +1 tap is applied on top of the committed quantity instead of 409', async () => {
	const { updateInventoryItemMutation } = loadMutations();
	const { tx, row, state } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		quantityDelta: 1,
	});
	assert.equal(result.kind, 'ok');
	assert.equal(state.locked, true);
	assert.equal(row.quantity, 7);
	assert.equal(result.delta, 1);
	assert.deepEqual(
		state.logs.map((log) => log.delta),
		[1],
	);
});

test('an absolute write keeps its optimistic conflict check', async () => {
	const { updateInventoryItemMutation } = loadMutations();
	const { tx, row, state } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		quantity: 3,
		expectedQuantity: 5,
		expectedUpdatedAt: updatedAt.toISOString(),
	});
	assert.equal(result.kind, 'conflict');
	assert.equal(state.locked, false);
	assert.equal(row.quantity, 6);
});

/** A single item row plus a record of what landed on the shopping list. */
function itemTx(initial) {
	const row = { id: 'item-1', wgId: 'wg-1', unit: 'Stück', updatedAt, ...initial };
	const shopping = [];
	const tx = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () =>
						Object.assign(Promise.resolve([{ ...row }]), {
							for: () => Promise.resolve([{ ...row }]),
						}),
				}),
			}),
		}),
		update: () => ({
			set: (updates) => ({
				where: () => ({
					returning: async () => {
						Object.assign(row, updates);
						return [{ ...row }];
					},
				}),
			}),
		}),
		insert: () => ({
			// Awaited directly for the log row; chained for the shopping insert.
			values: (value) => {
				const insert = Object.assign(Promise.resolve(undefined), {
					onConflictDoNothing: () => insert,
					returning: async () => {
						shopping.push(value);
						return [{ id: `shopping-${shopping.length}` }];
					},
				});
				return insert;
			},
		}),
	};
	return { tx, row, shopping };
}

test('renaming an item that is already low does not re-add it to the shopping list', async () => {
	const { updateInventoryItemMutation } = loadMutations({ inventory: loadRealInventory() });
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 1, threshold: 2 });
	const result = await updateInventoryItemMutation(tx, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		name: 'Spülmittel',
	});
	assert.equal(result.kind, 'ok');
	assert.equal(result.autoPushedShoppingItemId, null);
	assert.deepEqual(shopping, []);
});

test('dropping below the threshold puts the item on the shopping list once', async () => {
	const { updateInventoryItemMutation } = loadMutations({ inventory: loadRealInventory() });
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 3, threshold: 2 });
	const result = await updateInventoryItemMutation(tx, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		quantityDelta: -2,
	});
	assert.equal(result.kind, 'ok');
	assert.equal(result.autoPushedShoppingItemId, 'shopping-1');
	assert.equal(shopping.length, 1);
});
