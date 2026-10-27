import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { shoppingItems } from '../src/core/db/index.ts';
import type { ShoppingItem } from '../src/core/db/schema.ts';
import type { DbTransaction } from '../src/core/db/transaction.ts';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input.ts';
import {
	SHOPPING_CREATE_DUPLICATE_RESPONSE,
	type ShoppingCreateInput,
	type ShoppingCreateReplayResponse,
	insertShoppingItem,
	normalizeShoppingCreateReplayResponse,
	shoppingCreateCodec,
	shoppingCreateHttpResponse,
	withShoppingCreatePostCommitFallback,
} from '../src/features/shopping/server/shopping-mutation.ts';
import { isOpenShoppingItemDuplicate } from '../src/features/shopping/shopping-duplicate.ts';

describe('shopping input', () => {
	test('splits a leading amount from the item name', () => {
		assert.deepEqual(parseShoppingInput('2 Hafermilch'), { name: 'Hafermilch', quantity: '2' });
		assert.deepEqual(parseShoppingInput(' 1,5 L  Milch '), { name: 'Milch', quantity: '1,5 L' });
		assert.deepEqual(parseShoppingInput('3x Brot'), { name: 'Brot', quantity: '3x' });
		assert.deepEqual(parseShoppingInput('1 Packung Kaffee'), {
			name: 'Kaffee',
			quantity: '1 Packung',
		});
		assert.deepEqual(parseShoppingInput('7Up'), { name: '7Up', quantity: null });
		assert.deepEqual(parseShoppingInput('Milch'), { name: 'Milch', quantity: null });
		assert.deepEqual(parseShoppingInput('2'), { name: '2', quantity: null });
	});
});

describe('shopping duplicate detection', () => {
	test('recognizes a duplicate open shopping item through DrizzleQueryError.cause', () => {
		const postgresError = Object.assign(
			new Error('duplicate key value violates unique constraint'),
			{
				code: '23505',
				constraint: 'shopping_items_unique_open_name',
			},
		);
		const wrapped = new DrizzleQueryError('insert into shopping_items ...', [], postgresError);

		assert.equal(isOpenShoppingItemDuplicate(wrapped), true);
	});
});

// Claim, rollback release and same-key duplicate replay run through withIdempotentWrite and are
// covered by tests/idempotent-write.test.ts and the shopping route replay tests.
describe('shopping mutation regression', () => {
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
		assert.deepEqual(await insertShoppingItem(tx, input), item);
		assert.equal(state.insertCount, 1);
		const empty = createTransaction(false);
		assert.equal(await insertShoppingItem(empty.tx, input), undefined);
	});

	test('replays legacy successful shopping cache rows during the response-envelope rollout', () => {
		const legacyItem = JSON.parse(JSON.stringify(item));
		assert.deepEqual(normalizeShoppingCreateReplayResponse({ item: legacyItem, warning: null }), {
			status: 200,
			body: { item: legacyItem, warning: null },
		});
		assert.equal(normalizeShoppingCreateReplayResponse({ status: 201, body: {} }), null);
		assert.equal(shoppingCreateCodec.decode({ status: 201, body: {} }), null);
	});

	test('rejects malformed cached shopping success instead of replaying it as a saved item', () => {
		const serializedItem = JSON.parse(JSON.stringify(item));
		for (const malformedItem of [
			null,
			'shopping-1',
			{ id: 'shopping-1' },
			{ ...serializedItem, createdAt: null },
		]) {
			assert.equal(
				normalizeShoppingCreateReplayResponse({
					status: 200,
					body: { item: malformedItem, warning: null },
				}),
				null,
			);
			assert.equal(
				normalizeShoppingCreateReplayResponse({ item: malformedItem, warning: null }),
				null,
			);
		}
	});

	test('same-key duplicate responses are stored and replay as 409', async () => {
		const stored = shoppingCreateCodec.encode(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		assert.deepEqual(stored, SHOPPING_CREATE_DUPLICATE_RESPONSE);
		const replay = shoppingCreateCodec.decode(stored);
		assert.deepEqual(replay, SHOPPING_CREATE_DUPLICATE_RESPONSE);
		const httpResponse = shoppingCreateHttpResponse(SHOPPING_CREATE_DUPLICATE_RESPONSE);
		assert.equal(httpResponse.status, 409);
		assert.deepEqual(await httpResponse.json(), { error: 'shopping_item_duplicate' });
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
		assert.equal(ownerResponse.status, 200);
		assert.deepEqual(owner, provisional);
		assert.equal(sanitizedFailureLogs, 1);
	});
});
