import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';
import { isOpenShoppingItemDuplicate } from '../src/features/shopping/shopping-duplicate.ts';

// The partial unique index on open shopping items against a real PostgreSQL.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all migrations
// applied (`pnpm test:db`).
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

test('partial unique index rejects open duplicates and allows repurchase', { skip }, async () => {
	const pool = new pg.Pool({ connectionString: url, max: 1 });
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
		const cause = duplicateError.cause as { code?: string; constraint?: string };
		assert.equal(cause.code, '23505');
		assert.equal(cause.constraint, 'shopping_items_unique_open_name');
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
			'SELECT count(*)::int AS count FROM public.shopping_items WHERE wg_id = $1 AND normalized_name = lower(btrim($2))',
			[wgId, name],
		);
		assert.equal(rows.rows[0]?.count, 2);
	} finally {
		if (wgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [wgId]);
		if (secondWgId) await pool.query('DELETE FROM public.wgs WHERE id = $1', [secondWgId]);
		await pool.end();
	}
});
