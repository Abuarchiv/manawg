import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// The runtime pool module with the real connection-string resolution; only the pg pool and the
// drizzle instance are stand-ins that report which URL they were built from.

const pools: FakePool[] = [];
const state = { commitError: null as Error | null, attempts: 0 };

class FakePool {
	url: string;
	ended = false;
	constructor({ connectionString }: { connectionString: string }) {
		this.url = connectionString;
		pools.push(this);
	}
	on(): void {}
	async end(): Promise<void> {
		this.ended = true;
	}
}

mock.module('pg', { namedExports: { Pool: FakePool, Client: class {} } });
mock.module('drizzle-orm/node-postgres', {
	namedExports: {
		drizzle: (pool: FakePool) => ({
			readUrl: () => pool.url,
			transaction: async <T>(fn: (tx: { url: string }) => Promise<T>) => {
				state.attempts += 1;
				const result = await fn({ url: pool.url });
				if (state.commitError) throw state.commitError;
				return result;
			},
		}),
	},
});

const { db, withTransaction } = await import('./index');

const DB_ENV = ['POSTGRES_URL', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];

test('queries and transactions share one pool that follows URL changes without retrying unknown commits', async (t) => {
	const previous = Object.fromEntries(DB_ENV.map((name) => [name, process.env[name]]));
	t.after(() => {
		for (const name of DB_ENV) {
			const value = previous[name];
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	});
	for (const name of DB_ENV) Reflect.deleteProperty(process.env, name);
	t.mock.method(console, 'warn', () => undefined);

	const readUrl = () => (db as unknown as { readUrl: () => string }).readUrl();
	const transactionUrl = () =>
		withTransaction(async (tx) => (tx as unknown as { url: string }).url);

	process.env.POSTGRES_URL = 'postgres://localhost/database_a';
	assert.equal(readUrl(), await transactionUrl());
	assert.equal(pools.length, 1);
	process.env.POSTGRES_URL = 'postgres://localhost/database_b';
	assert.equal(readUrl(), await transactionUrl());
	assert.equal(pools.length, 2);
	assert.ok(pools[0]?.ended && !pools[1]?.ended);

	// Direct-connection variables belong to migrations; runtime transactions stay on the pool.
	process.env.DATABASE_URL_UNPOOLED = 'postgres://localhost/direct_a';
	process.env.POSTGRES_URL_NON_POOLING = 'postgres://localhost/direct_b';
	assert.equal(await transactionUrl(), readUrl());
	assert.equal(pools.length, 2);
	Reflect.deleteProperty(process.env, 'POSTGRES_URL');
	process.env.DATABASE_URL = 'postgres://localhost/database_c';
	assert.equal(readUrl(), await transactionUrl());
	assert.equal(pools.length, 3);

	state.commitError = new Error('connection lost after COMMIT');
	const attemptsBefore = state.attempts;
	await assert.rejects(transactionUrl(), (error) => error === state.commitError);
	assert.equal(state.attempts, attemptsBefore + 1);
});
