import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../src/core/db/schema.ts';

// The claim and purge SQL of the durable idempotency store against a real PostgreSQL.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database with all migrations applied.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}
const pool = new pg.Pool({ connectionString: url || undefined, max: 2 });
const database = drizzle(pool, { schema });
mock.module('@/core/db', {
	namedExports: { ...schema, db: database },
});
const store = await import('../src/core/idempotency-store.ts');

async function setExpiry(scope: string, key: string, sqlExpr: string) {
	await pool.query(
		`update idempotency_responses set expires_at = ${sqlExpr} where scope = $1 and key = $2`,
		[scope, key],
	);
}

test('a live claim cannot be taken over, an expired one can', { skip }, async () => {
	const scope = `claim-${randomUUID()}`;
	const key = randomUUID();
	try {
		const first = await store.claimResponseSlot(scope, key);
		assert.ok(first instanceof Date);
		// A retry that arrives while the first request still runs must wait, not run the write twice.
		assert.equal(await store.claimResponseSlot(scope, key), null);
		// A placeholder counts as no response.
		assert.equal(await store.getCachedResponse(scope, key), null);

		// The lease is 15 minutes, not seconds: a long write must keep its claim.
		const { rows } = await pool.query<{ left: number }>(
			'select extract(epoch from expires_at - now()) as left from idempotency_responses where scope = $1',
			[scope],
		);
		assert.ok((rows[0]?.left ?? 0) > 14 * 60 && (rows[0]?.left ?? 0) <= 15 * 60);

		// Once the lease has run out (a worker that died), the next retry reclaims the slot.
		await setExpiry(scope, key, "now() - interval '1 second'");
		assert.equal(await store.getCachedResponse(scope, key), null);
		assert.ok((await store.claimResponseSlot(scope, key)) instanceof Date);
	} finally {
		await pool.query('delete from idempotency_responses where scope = $1', [scope]);
	}
});

test('purge removes expired rows in batches and keeps live ones', { skip }, async () => {
	const scope = `purge-${randomUUID()}`;
	try {
		await pool.query(
			`insert into idempotency_responses (scope, key, response_body, expires_at)
			 select $1, gen_random_uuid()::text, '{}'::jsonb, now() - interval '1 day' from generate_series(1, 5200)`,
			[scope],
		);
		await pool.query(
			`insert into idempotency_responses (scope, key, response_body, expires_at)
			 values ($1, 'live', '{}'::jsonb, now() + interval '1 day')`,
			[scope],
		);
		const deleted = await store.purgeExpiredIdempotencyResponses();
		assert.ok(deleted >= 5200, `deleted ${deleted}`);
		const left = await pool.query<{ key: string }>(
			'select key from idempotency_responses where scope = $1',
			[scope],
		);
		assert.deepEqual(
			left.rows.map((row) => row.key),
			['live'],
		);
		// A row that expires exactly at the cut-off is gone.
		const at = new Date('2026-01-01T00:00:00Z');
		await pool.query(
			`insert into idempotency_responses (scope, key, response_body, expires_at) values ($1, 'edge', '{}'::jsonb, $2)`,
			[scope, at],
		);
		await store.purgeExpiredIdempotencyResponses(at);
		const edge = await pool.query(
			'select 1 from idempotency_responses where scope = $1 and key = $2',
			[scope, 'edge'],
		);
		assert.equal(edge.rowCount, 0);
	} finally {
		await pool.query('delete from idempotency_responses where scope = $1', [scope]);
	}
});

test('readIdempotencyKey lowercases the key so one UUID cannot claim two slots', () => {
	const upper = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
	const req = (value: string) => new Request('http://x', { headers: { 'Idempotency-Key': value } });
	assert.equal(store.readIdempotencyKey(req(upper)), upper.toLowerCase());
	assert.equal(store.readIdempotencyKey(req(` ${upper.toLowerCase()} `)), upper.toLowerCase());
	assert.equal(store.readIdempotencyKey(req(`x${upper}`)), null);
	assert.equal(store.readIdempotencyKey(req(`${upper}x`)), null);
});

test.after(async () => {
	await pool.end();
});
