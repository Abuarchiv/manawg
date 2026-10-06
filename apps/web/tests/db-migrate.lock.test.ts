import assert from 'node:assert/strict';
import test from 'node:test';
import { safeFailureReason } from '../scripts/db-migrate/failure.mjs';
import {
	MigrationLockBusyError,
	acquireMigrationLock,
	releaseMigrationLock,
} from '../scripts/db-migrate/lock.mjs';

interface Query {
	sql: string;
	params: unknown[] | undefined;
}

function fakeClock() {
	let current = 0;
	const sleeps: number[] = [];
	return {
		sleeps,
		now: () => current,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			current += ms;
		},
	};
}

function lockClient(results: boolean[]) {
	const queries: Query[] = [];
	return {
		queries,
		query: async (sql: string, params?: unknown[]) => {
			queries.push({ sql, params });
			if (sql.includes('pg_try_advisory_lock'))
				return { rows: [{ locked: results.shift() ?? false }] };
			if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
			throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
		},
	};
}

test('acquires the advisory lock without waiting when it is free', async () => {
	const client = lockClient([true]);
	const clock = fakeClock();
	await acquireMigrationLock(client, { ...clock, waitMs: 5_000, retryMs: 1_000 });
	assert.equal(client.queries.length, 1);
	assert.deepEqual(client.queries[0]?.params, ['manawg:drizzle-migrate']);
	assert.deepEqual(clock.sleeps, []);
});

test('retries until another migrator releases the lock', async () => {
	const client = lockClient([false, false, true]);
	const clock = fakeClock();
	await acquireMigrationLock(client, { ...clock, waitMs: 5_000, retryMs: 1_000 });
	assert.equal(client.queries.length, 3);
	assert.deepEqual(clock.sleeps, [1_000, 1_000]);
});

test('gives up with a classified error once the wait budget is spent', async () => {
	const client = lockClient([]);
	const clock = fakeClock();
	const error = await acquireMigrationLock(client, {
		...clock,
		waitMs: 2_500,
		retryMs: 1_000,
	}).then(
		() => assert.fail('expected the lock wait to fail'),
		(caught: unknown) => caught,
	);
	assert.ok(error instanceof MigrationLockBusyError);
	assert.match(error.message, /gave up after 2\.5s/);
	assert.equal(safeFailureReason(error), 'migration-lock-busy');
	assert.deepEqual(clock.sleeps, [1_000, 1_000, 500]);
});

test('releases the session advisory lock by name', async () => {
	const client = lockClient([]);
	await releaseMigrationLock(client);
	assert.deepEqual(client.queries, [
		{ sql: 'select pg_advisory_unlock(hashtext($1))', params: ['manawg:drizzle-migrate'] },
	]);
});
