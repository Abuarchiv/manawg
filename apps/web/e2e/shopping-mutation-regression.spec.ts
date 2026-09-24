import { expect, test } from '@playwright/test';
import { idempotencyResponses, shoppingItems } from '../src/core/db';
import type { ShoppingItem } from '../src/core/db/schema';
import type { DbTransaction } from '../src/core/db/transaction';
import { type ReplaySlotDependencies, claimReplaySlot } from '../src/core/guards/replay-slot';
import {
	SHOPPING_CREATE_DUPLICATE_RESPONSE,
	type ShoppingCreateInput,
	type ShoppingCreateReplayResponse,
	ShoppingCreateTransactionRollback,
	finalizeShoppingCreateDuplicateReplay,
	handleShoppingCreateTransactionFailure,
	insertShoppingItemWithReplay,
	normalizeShoppingCreateReplayOrReject,
	normalizeShoppingCreateReplayResponse,
	persistShoppingCreateReplayResponse,
	resolveShoppingCreateReplay,
	shoppingCreateHttpResponse,
	withShoppingCreatePostCommitFallback,
} from '../src/features/shopping/shopping-mutation';

type CachedShoppingResponse = ShoppingCreateReplayResponse;

type State = {
	item: ShoppingItem | null;
	insertCount: number;
	response: CachedShoppingResponse | null;
	claimHeld: boolean;
};

function createReservation() {
	let resolveWaiter!: (response: ShoppingCreateReplayResponse) => void;
	let rejectWaiter!: (reason: unknown) => void;
	const promise = new Promise<ShoppingCreateReplayResponse>((resolve, reject) => {
		resolveWaiter = resolve;
		rejectWaiter = reject;
	});
	promise.catch(() => undefined);
	return {
		reservation: {
			owned: true as const,
			resolve: resolveWaiter,
			reject: rejectWaiter,
		},
		waiter: promise,
	};
}

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
	replay: { scope: 'shopping-create:wg:member', key: 'same-key' },
};

function createTransaction(state: State, returnItem = true): DbTransaction {
	const insert = (table: unknown) => {
		if (table === shoppingItems) {
			return {
				values: () => ({
					returning: async () => {
						state.insertCount += 1;
						if (!returnItem) return [];
						state.item = item;
						return [item];
					},
				}),
			};
		}
		if (table === idempotencyResponses) {
			return {
				values: (values: { responseBody: CachedShoppingResponse }) => ({
					onConflictDoUpdate: async () => {
						state.response = values.responseBody;
					},
				}),
			};
		}
		throw new Error('unexpected table');
	};
	const update = (table: unknown) => {
		let values: { responseBody: CachedShoppingResponse } | null = null;
		const query = {
			set(nextValues: { responseBody: CachedShoppingResponse }) {
				values = nextValues;
				return query;
			},
			where() {
				return query;
			},
			returning: async () => {
				if (table !== idempotencyResponses || !state.claimHeld || !values) return [];
				state.response = values.responseBody;
				return [{ key: input.replay?.key ?? 'same-key' }];
			},
		};
		return query;
	};
	return { insert, update } as unknown as DbTransaction;
}

function replayDependencies(state: State): ReplaySlotDependencies<ShoppingCreateReplayResponse> {
	return {
		claim: async () => {
			if (state.claimHeld) return false;
			state.claimHeld = true;
			return true;
		},
		read: async () => state.response,
		sleep: async () => undefined,
	};
}

test('shopping create persists a replayable item response in the same transaction', async () => {
	const state: State = { item: null, insertCount: 0, response: null, claimHeld: true };
	const tx = createTransaction(state);

	await expect(insertShoppingItemWithReplay(tx, input)).resolves.toEqual(item);
	expect(state.response).toMatchObject({
		status: 200,
		body: { item: { id: 'shopping-1' }, warning: 'notification_delivery_unknown' },
	});
	expect(state.insertCount).toBe(1);
});

test('shopping create does not cache a response when no item is returned', async () => {
	const state: State = { item: null, insertCount: 0, response: null, claimHeld: false };
	await expect(insertShoppingItemWithReplay(createTransaction(state, false), input)).resolves.toBe(
		undefined,
	);
	expect(state.response).toBeNull();
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

test('invalid persisted replay releases local waiters instead of leaving them pending', async () => {
	const local = createReservation();

	expect(
		normalizeShoppingCreateReplayOrReject({ status: 201, body: {} }, local.reservation),
	).toBeNull();
	await expect(local.waiter).rejects.toMatchObject({ message: 'idempotency_response_pending' });
});

test('same-key duplicate responses reach local waiters and cross-process replays as 409', async () => {
	const local = createReservation();
	resolveShoppingCreateReplay(local.reservation, SHOPPING_CREATE_DUPLICATE_RESPONSE);
	await expect(local.waiter).resolves.toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
	const localHttpResponse = shoppingCreateHttpResponse(SHOPPING_CREATE_DUPLICATE_RESPONSE);
	expect(localHttpResponse.status).toBe(409);
	await expect(localHttpResponse.json()).resolves.toEqual({ error: 'shopping_item_duplicate' });

	const state: State = { item: null, insertCount: 0, response: null, claimHeld: true };
	await expect(
		persistShoppingCreateReplayResponse(
			createTransaction(state),
			'shopping-create:wg:member',
			'same-key',
			SHOPPING_CREATE_DUPLICATE_RESPONSE,
		),
	).resolves.toBe(true);
	const crossProcessRetry = await claimReplaySlot(
		'shopping-create:wg:member',
		'same-key',
		replayDependencies(state),
	);
	expect(crossProcessRetry).toEqual({
		won: false,
		cached: SHOPPING_CREATE_DUPLICATE_RESPONSE,
	});
	if (!crossProcessRetry.won) {
		const crossProcessHttpResponse = shoppingCreateHttpResponse(crossProcessRetry.cached);
		expect(crossProcessHttpResponse.status).toBe(409);
	}
});

test('known rollback releases the claim; unknown commit outcome keeps it fail-closed', async () => {
	const rollbackState: State = { item: null, insertCount: 0, response: null, claimHeld: false };
	const rollbackDependencies = replayDependencies(rollbackState);
	await expect(
		claimReplaySlot('shopping-create:wg:member', 'same-key', rollbackDependencies),
	).resolves.toEqual({ won: true });
	const rollbackReservation = createReservation().reservation;
	let rollbackReleaseCount = 0;
	const rolledBack = await handleShoppingCreateTransactionFailure(
		rollbackReservation,
		new ShoppingCreateTransactionRollback(new Error('query failed before commit')),
		async () => {
			rollbackReleaseCount += 1;
			rollbackState.claimHeld = false;
			return true;
		},
	);
	expect(rolledBack).toBe('rolled_back');
	expect(rollbackReleaseCount).toBe(1);
	await expect(
		claimReplaySlot('shopping-create:wg:member', 'same-key', rollbackDependencies),
	).resolves.toEqual({ won: true });

	const unknownState: State = { item: null, insertCount: 0, response: null, claimHeld: false };
	const unknownDependencies = replayDependencies(unknownState);
	await expect(
		claimReplaySlot('shopping-create:wg:member', 'same-key', unknownDependencies),
	).resolves.toEqual({ won: true });
	const unknownReservation = createReservation().reservation;
	let unknownReleaseCount = 0;
	const unknown = await handleShoppingCreateTransactionFailure(
		unknownReservation,
		new Error('connection dropped during commit'),
		async () => {
			unknownReleaseCount += 1;
			unknownState.claimHeld = false;
			return true;
		},
	);
	expect(unknown).toBe('unknown_commit');
	expect(unknownReleaseCount).toBe(0);
	await expect(
		claimReplaySlot('shopping-create:wg:member', 'same-key', unknownDependencies),
	).rejects.toMatchObject({ message: 'idempotency_response_pending' });
});

test('post-commit side-effect failure returns the durable response to owner and waiter', async () => {
	const local = createReservation();
	const provisional: ShoppingCreateReplayResponse = {
		status: 200,
		body: { item, warning: 'notification_delivery_unknown' },
	};
	resolveShoppingCreateReplay(local.reservation, provisional);
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
	const waiter = await local.waiter;
	const ownerResponse = shoppingCreateHttpResponse(owner);
	const waiterResponse = shoppingCreateHttpResponse(waiter);
	const [ownerBody, waiterBody] = await Promise.all([ownerResponse.json(), waiterResponse.json()]);
	expect(ownerResponse.status).toBe(200);
	expect(waiterResponse.status).toBe(200);
	expect(waiterBody).toEqual(ownerBody);
	expect(owner).toEqual(provisional);
	expect(sanitizedFailureLogs).toBe(1);
});

test('duplicate stays retryable unless its replay is persisted or claim cleanup succeeds', async () => {
	const cleanupSuccess = createReservation();
	let cleanupCalls = 0;
	const duplicate = await finalizeShoppingCreateDuplicateReplay(cleanupSuccess.reservation, {
		persist: async () => false,
		read: async () => null,
		release: async () => {
			cleanupCalls += 1;
			return true;
		},
	});
	await expect(cleanupSuccess.waiter).resolves.toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
	expect(duplicate).toEqual(SHOPPING_CREATE_DUPLICATE_RESPONSE);
	expect(cleanupCalls).toBe(1);

	const cleanupFailure = createReservation();
	const failed = await finalizeShoppingCreateDuplicateReplay(cleanupFailure.reservation, {
		persist: async () => {
			throw new Error('cache write unavailable');
		},
		read: async () => null,
		release: async () => false,
	});
	expect(failed).toBeNull();
	await expect(cleanupFailure.waiter).rejects.toMatchObject({
		message: 'idempotency_response_pending',
	});
});
