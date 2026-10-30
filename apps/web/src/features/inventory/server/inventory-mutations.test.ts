import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const updatedAt = new Date('2026-09-29T10:00:00.000Z');
const wgInventoryItems = { id: 'id', wgId: 'wgId', quantity: 'quantity', updatedAt: 'updatedAt' };

mock.module('@/core/db', {
	namedExports: {
		db: {},
		shoppingItems: {},
		wgInventoryItems,
		wgInventoryLog: { name: 'log' },
	},
});
// Conditions stay the fake query builders' own tuples, so the fake update can match rows.
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => parts,
		eq: (column: unknown, value: unknown) => [column, value],
		sql: () => null,
	},
});

const { updateInventoryItemMutation } = await import('./inventory-mutations');
const { consumeInventoryMutation } = await import('./consume-mutation');

type Row = Record<string, unknown>;

/**
 * Another tap committed quantity 5 -> 6 after this transaction started: a
 * plain read still sees the stale 5, a locking read waits and sees the 6.
 */
function concurrentTapTx(staleQuantity = 5) {
	const row = { id: 'item-1', wgId: 'wg-1', name: 'Spüli', quantity: 6, threshold: 0, updatedAt };
	const state = { locked: false, logs: [] as Row[] };
	const tx = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () => {
						const stale = Promise.resolve([{ ...row, quantity: staleQuantity }]);
						return Object.assign(stale, {
							for: (mode: string) => {
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
			set: (updates: Row) => ({
				where: (conditions: unknown[]) => ({
					returning: async () => {
						const matches = conditions.every(
							(condition) =>
								!Array.isArray(condition) || row[condition[0] as keyof typeof row] === condition[1],
						);
						if (!matches) return [];
						Object.assign(row, updates);
						return [{ ...row }];
					},
				}),
			}),
		}),
		insert: () => ({
			values: async (value: Row) => {
				state.logs.push(value);
			},
		}),
	};
	return { tx, row, state };
}

test('a concurrent +1 tap is applied on top of the committed quantity instead of 409', async () => {
	const { tx, row, state } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
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

test('a name-only edit is applied on top of a concurrent tap instead of 409', async () => {
	const { tx, row, state } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		name: 'x',
	});
	assert.equal(result.kind, 'ok');
	assert.equal(state.locked, true);
	assert.equal(row.quantity, 6);
	assert.equal(row.name, 'x');
	assert.deepEqual(state.logs, []);
});

test('an absolute quantity edit is logged as an adjustment, not as consumption', async () => {
	const { tx, state } = concurrentTapTx(6);
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		quantity: 2,
		expectedQuantity: 6,
		expectedUpdatedAt: updatedAt.toISOString(),
	});
	assert.equal(result.kind, 'ok');
	assert.deepEqual(
		state.logs.map((log) => [log.delta, log.kind]),
		[[-4, 'adjust']],
	);
});

test('an absolute write keeps its optimistic conflict check', async () => {
	const { tx, row, state } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		quantity: 3,
		expectedQuantity: 5,
		expectedUpdatedAt: updatedAt.toISOString(),
	});
	assert.equal(result.kind, 'conflict');
	assert.equal(state.locked, false);
	assert.equal(row.quantity, 6);
});

test('a retried absolute write whose answer got lost finds its quantity in place', async () => {
	const { tx } = concurrentTapTx();
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		quantity: 5,
		expectedQuantity: 4,
		expectedUpdatedAt: updatedAt.toISOString(),
	});
	assert.equal(result.kind, 'held');
});

/** A single item row plus a record of what landed on the shopping list. */
function itemTx(initial: Row) {
	const row = { id: 'item-1', wgId: 'wg-1', unit: 'piece', updatedAt, ...initial };
	const shopping: Row[] = [];
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
			set: (updates: Row) => ({
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
			values: (value: Row) => {
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
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 1, threshold: 2 });
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		name: 'Spülmittel',
	});
	assert.equal(result.kind, 'ok');
	assert.equal(result.autoPushedShoppingItemId, null);
	assert.deepEqual(shopping, []);
});

test('dropping below the threshold puts the item on the shopping list once', async () => {
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 3, threshold: 2 });
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		quantityDelta: -2,
	});
	assert.equal(result.kind, 'ok');
	assert.equal(result.autoPushedShoppingItemId, 'shopping-1');
	assert.equal(shopping.length, 1);
});

test('consuming an item that is already at the threshold does not re-add or re-notify', async () => {
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 3, threshold: 3 });
	const result = await consumeInventoryMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		delta: -1,
	});
	assert.equal(result.kind, 'ok');
	assert.equal(result.kind === 'ok' && result.autoPushedShoppingItemId, null);
	assert.equal(result.kind === 'ok' && result.justCrossedThreshold, false);
	assert.deepEqual(shopping, []);
});

test('consuming across the threshold pushes exactly one shopping item', async () => {
	const { tx, shopping } = itemTx({ name: 'Spüli', quantity: 4, threshold: 3 });
	const result = await consumeInventoryMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		delta: -1,
	});
	assert.equal(result.kind === 'ok' && result.autoPushedShoppingItemId, 'shopping-1');
	assert.equal(result.kind === 'ok' && result.justCrossedThreshold, true);
	assert.equal(shopping.length, 1);
});

test('consuming one unit from 0,5 empties the item and logs -0.5', async () => {
	const { tx } = itemTx({ name: 'Milch', quantity: 0.5, threshold: 0 });
	const result = await consumeInventoryMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		delta: -1,
	});
	assert.equal(result.kind === 'ok' && result.updated.quantity, 0);
	assert.equal(result.kind === 'ok' && result.appliedDelta, -0.5);
	assert.equal(result.kind === 'ok' && result.clamped, true);
});

test('consuming one unit from 2,3 is not reported as clamped and logs exactly -1', async () => {
	const { tx } = itemTx({ name: 'Milch', quantity: 2.3, threshold: 0 });
	const result = await consumeInventoryMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		delta: -1,
	});
	assert.equal(result.kind === 'ok' && result.updated.quantity, 1.3);
	assert.equal(result.kind === 'ok' && result.appliedDelta, -1);
	assert.equal(result.kind === 'ok' && result.clamped, false);
});

test('a name-only update ignores a changed updatedAt and does not conflict', async () => {
	const { tx } = itemTx({ name: 'Spüli', quantity: 5, threshold: 1 });
	const result = await updateInventoryItemMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		locale: 'de',
		name: 'Spülmittel',
	});
	assert.equal(result.kind, 'ok');
});

/** Quantity text of the shopping entry written when a consume takes three units off, leaving `left` at or below `threshold`. */
async function autoRestockQuantity(
	locale: 'de' | 'en',
	unit: string,
	left: number,
	threshold: number,
) {
	const { tx, shopping } = itemTx({ name: 'Item', unit, quantity: left + 3, threshold });
	await consumeInventoryMutation(tx as never, {
		itemId: 'item-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		delta: -3,
		locale,
	});
	return shopping[0]?.quantity;
}

test('the auto-restock quantity reads in the language of the person who triggered it', async () => {
	assert.equal(await autoRestockQuantity('de', 'roll', 2, 3), '2 Rollen');
	assert.equal(await autoRestockQuantity('de', 'roll', 3, 3), '1 Rolle');
	assert.equal(await autoRestockQuantity('de', 'piece', 2, 4), '3 Stück');
	assert.equal(await autoRestockQuantity('de', 'pack', 1.5, 2), '1,5 Packungen');
	assert.equal(await autoRestockQuantity('de', 'Flasche', 2, 3), '2 Flasche');
	assert.equal(await autoRestockQuantity('en', 'roll', 2, 3), '2 rolls');
	assert.equal(await autoRestockQuantity('en', 'roll', 3, 3), '1 roll');
	assert.equal(await autoRestockQuantity('en', 'pack', 1.5, 2), '1.5 packs');
	assert.equal(await autoRestockQuantity('en', 'Flasche', 2, 3), '2 Flasche');
});
