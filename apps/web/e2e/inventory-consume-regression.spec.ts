import { expect, test } from '@playwright/test';
import { shoppingItems, wgInventoryItems, wgInventoryLog } from '../src/core/db';
import type { DbTransaction } from '../src/core/db/transaction';
import { type ReplaySlotDependencies, claimReplaySlot } from '../src/core/guards/replay-slot';
import {
	type ConsumeInventoryMutationInput,
	consumeInventoryMutation,
} from '../src/features/inventory/consume-mutation';

type InventoryState = {
	item: {
		id: string;
		wgId: string;
		name: string;
		quantity: number;
		unit: string;
		threshold: number;
		category: string;
		lastDecrementedAt: Date | null;
		createdAt: Date;
		updatedAt: Date;
	};
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
				return Promise.resolve(table === wgInventoryItems ? [state.item] : []);
			},
			// biome-ignore lint/suspicious/noThenProperty: Drizzle queries are thenable; this fake mirrors that contract.
			then(onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
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
			then(onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) {
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
	key = 'same-key',
) {
	const slot = await claimReplaySlot('inventory-consume', key, dependencies);
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

test('inventory consume does not mutate when claim or cache read fails', async () => {
	const claimFailureState = createState();
	const claimFailure: ReplaySlotDependencies<ReplayBody> = {
		claim: async () => {
			throw new Error('claim_failed');
		},
		read: async () => null,
		sleep: async () => undefined,
	};
	await expect(mutateIfWinner(claimFailure, claimFailureState, { value: null })).rejects.toThrow(
		'claim_failed',
	);
	expect(claimFailureState.updateCount).toBe(0);
	expect(claimFailureState.logs).toHaveLength(0);

	const cacheFailureState = createState();
	const cacheFailure: ReplaySlotDependencies<ReplayBody> = {
		claim: async () => false,
		read: async () => {
			throw new Error('cache_read_failed');
		},
		sleep: async () => undefined,
	};
	await expect(mutateIfWinner(cacheFailure, cacheFailureState, { value: null })).rejects.toThrow(
		'cache_read_failed',
	);
	expect(cacheFailureState.updateCount).toBe(0);
	expect(cacheFailureState.logs).toHaveLength(0);
});

test('a new idempotency key can mutate after a failed claim', async () => {
	const state = createState();
	const failedDependencies: ReplaySlotDependencies<ReplayBody> = {
		claim: async () => {
			throw new Error('claim_failed');
		},
		read: async () => null,
		sleep: async () => undefined,
	};
	await expect(
		mutateIfWinner(failedDependencies, state, { value: null }, 'failed-key'),
	).rejects.toThrow('claim_failed');
	expect(state.updateCount).toBe(0);

	const dependencies: ReplaySlotDependencies<ReplayBody> = {
		claim: async () => true,
		read: async () => null,
		sleep: async () => undefined,
	};

	await expect(mutateIfWinner(dependencies, state, { value: null }, 'new-key')).resolves.toEqual({
		won: true,
		body: { quantity: 4 },
	});
	expect(state.updateCount).toBe(1);
});
