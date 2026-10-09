import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { closeClientOnQueryTimeout, resolveConnectionString } from './connection';
import * as schema from './schema';
import type { DbTransaction } from './transaction';

type DbInstance = Omit<NodePgDatabase<typeof schema>, 'transaction'>;

interface CachedDb {
	drizzle: NodePgDatabase<typeof schema>;
	pool: Pool;
	/** Raw connection-string source the pool was built from (see currentDbSource). */
	source: string;
}

let cachedDb: CachedDb | null = null;

function currentDbSource(): string {
	return process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
}

function invalidateDb(pool: Pool, err: Error): void {
	if (cachedDb?.pool !== pool) return;
	cachedDb = null;
	console.error('[db] Pool error; invalidating connection pool:', err.message);
	void pool.end().catch((endError: unknown) => {
		console.error('[db] Pool shutdown failed:', endError);
	});
}

// Module-level pools survive dev hot-reloads and long-lived serverless
// instances. If POSTGRES_URL/DATABASE_URL changes underneath (env swap, hot
// reload after an .env edit), the old pool must not keep serving: it is
// dropped and rebuilt on next access instead of being cached forever.
function dropStaleDb(): void {
	if (!cachedDb || cachedDb.source === currentDbSource()) return;
	const stale = cachedDb;
	cachedDb = null;
	console.warn('[db] Connection string changed; rebuilding connection pool.');
	void stale.pool.end().catch((endError: unknown) => {
		console.error('[db] Stale pool shutdown failed:', endError);
	});
}

/**
 * The only runtime pool: plain queries (`db`) and transactions (`withTransaction`)
 * share it, on the pooled Supavisor URL. Drizzle binds BEGIN/COMMIT to one
 * checked-out client and advisory locks are transaction-scoped, both of which
 * Supavisor transaction mode supports.
 *
 * Connection budget: at most 5 connections per warm serverless instance. The
 * only other runtime connection is the short-lived client `withFreshTransaction`
 * opens to resolve an uncertain commit.
 */
function getDrizzle(): NodePgDatabase<typeof schema> {
	dropStaleDb();
	if (cachedDb) return cachedDb.drizzle;
	const pool = new Pool({
		connectionString: resolveConnectionString(),
		max: 5,
		connectionTimeoutMillis: 2_000,
		lock_timeout: 2_000,
		query_timeout: 5_500,
		statement_timeout: 5_000,
	});
	pool.on('connect', closeClientOnQueryTimeout);
	pool.on('error', (err) => invalidateDb(pool, err));
	cachedDb = { drizzle: drizzle(pool, { schema }), pool, source: currentDbSource() };
	return cachedDb.drizzle;
}

// The proxy defers building the pool to first use. Its `{}` target owns no
// state; every property read is served from the real drizzle instance.
// `transaction` is left out of the type so writes go through withTransaction.
export const db: DbInstance = new Proxy({} as DbInstance, {
	get(_target, prop) {
		const instance = getDrizzle();
		const value = Reflect.get(instance, prop);
		return typeof value === 'function' ? value.bind(instance) : value;
	},
});

export function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
	return getDrizzle().transaction(fn);
}

export * from './schema';
export * from './schema-statement-emails';
