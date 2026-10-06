// Shopping list rules: quick input parsing, create/replay response safety and duplicate detection.
// Two roommates edit the same list concurrently; duplicates and retries must resolve
// deterministically.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { shoppingItems } from '../src/core/db';
import type { ShoppingItem } from '../src/core/db/schema';
import * as schema from '../src/core/db/schema';
import type { DbTransaction } from '../src/core/db/transaction';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';
import { isOpenShoppingItemDuplicate } from '../src/features/shopping/shopping-duplicate';
import {
	SHOPPING_CREATE_DUPLICATE_RESPONSE,
	type ShoppingCreateInput,
	type ShoppingCreateReplayResponse,
	insertShoppingItem,
	normalizeShoppingCreateReplayResponse,
	shoppingCreateCodec,
	shoppingCreateHttpResponse,
	withShoppingCreatePostCommitFallback,
} from '../src/features/shopping/shopping-mutation';
import { assertMatchObject } from './support/match-object';

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
		assert.deepEqual(
			normalizeShoppingCreateReplayResponse({
				item: legacyItem,
				warning: null,
			}),
			{
				status: 200,
				body: { item: legacyItem, warning: null },
			},
		);
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

describe('shopping conflict handling', () => {
	const testDatabaseUrl = process.env.PILOT_SHOPPING_DATABASE_URL?.trim() ?? '';
	const skip = testDatabaseUrl
		? false
		: 'Set PILOT_SHOPPING_DATABASE_URL to an isolated local PostgreSQL database.';

	function localTestDatabaseUrl(): string {
		const hostname = new URL(testDatabaseUrl).hostname.toLowerCase();
		assert.ok(['localhost', '127.0.0.1', '::1'].includes(hostname));
		return testDatabaseUrl;
	}

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

	test(
		'real PostgreSQL partial unique index rejects open duplicates and allows repurchase',
		{ skip },
		async () => {
			const pool = new Pool({ connectionString: localTestDatabaseUrl(), max: 1 });
			const database = drizzle(pool, { schema });
			const suffix = randomUUID().replaceAll('-', '');
			let wgId = '';
			let secondWgId = '';
			const name = `Pilot shopping ${suffix}`;
			const normalizedVariant = `  ${name.toUpperCase()}  `;

			try {
				const wg = await pool.query<{ id: string }>(
					'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
					[`P${suffix.slice(0, 7)}`, `Pilot shopping ${suffix}`],
				);
				wgId = wg.rows[0]?.id ?? '';
				assert.ok(wgId);
				const secondWg = await pool.query<{ id: string }>(
					'INSERT INTO public.wgs (share_code, name) VALUES ($1, $2) RETURNING id',
					[`Q${suffix.slice(0, 7)}`, `Pilot shopping second ${suffix}`],
				);
				secondWgId = secondWg.rows[0]?.id ?? '';
				assert.ok(secondWgId);

				const member = await pool.query<{ id: string }>(
					'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
					[wgId, `Pilot member ${suffix}`],
				);
				const memberId = member.rows[0]?.id ?? '';
				assert.ok(memberId);
				const secondMember = await pool.query<{ id: string }>(
					'INSERT INTO public.wg_members (wg_id, name) VALUES ($1, $2) RETURNING id',
					[secondWgId, `Pilot second member ${suffix}`],
				);
				const secondMemberId = secondMember.rows[0]?.id ?? '';
				assert.ok(secondMemberId);

				const first = await database
					.insert(schema.shoppingItems)
					.values({ wgId, addedByMemberId: memberId, name, quantity: '1x' })
					.returning({ id: schema.shoppingItems.id });
				assert.equal(first.length, 1);

				let duplicateError: unknown;
				try {
					await database
						.insert(schema.shoppingItems)
						.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
						.returning({ id: schema.shoppingItems.id });
				} catch (error) {
					duplicateError = error;
				}
				assert.ok(duplicateError instanceof DrizzleQueryError);
				assertMatchObject(duplicateError, {
					cause: { code: '23505', constraint: 'shopping_items_unique_open_name' },
				});
				assert.equal(isOpenShoppingItemDuplicate(duplicateError), true);

				await pool.query(
					'UPDATE public.shopping_items SET bought_at = now(), bought_by_member_id = $2 WHERE id = $1',
					[first[0]?.id, memberId],
				);
				const repurchase = await database
					.insert(schema.shoppingItems)
					.values({ wgId, addedByMemberId: memberId, name: normalizedVariant, quantity: '2x' })
					.returning({ id: schema.shoppingItems.id });
				assert.equal(repurchase.length, 1);

				const otherWgItem = await database
					.insert(schema.shoppingItems)
					.values({
						wgId: secondWgId,
						addedByMemberId: secondMemberId,
						name: normalizedVariant,
						quantity: '1x',
					})
					.returning({ id: schema.shoppingItems.id });
				assert.equal(otherWgItem.length, 1);

				const rows = await pool.query<{ count: number }>(
					' SELECT count(*)::int AS count FROM public.shopping_items WHERE wg_id = $1 AND normalized_name = lower(btrim($2))',
					[wgId, name],
				);
				assert.equal(rows.rows[0]?.count, 2);
			} finally {
				if (wgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [wgId]);
				if (secondWgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [secondWgId]);
				await pool.end();
			}
		},
	);
});
