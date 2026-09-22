import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveConnectionString } from './connection';
import * as schema from './schema';

type DbInstance = Omit<NodePgDatabase<typeof schema>, 'transaction'>;

interface CachedDb {
	db: DbInstance;
	pool: Pool;
}

let cachedDb: CachedDb | null = null;

function invalidateDb(pool: Pool, err: Error): void {
	if (cachedDb?.pool !== pool) return;
	cachedDb = null;
	console.error('[db] Pool error; invalidating connection pool:', err.message);
	void pool.end().catch((endError: unknown) => {
		console.error('[db] Pool shutdown failed:', endError);
	});
}

function buildDb(): CachedDb {
	const url = resolveConnectionString();
	const pool = new Pool({ connectionString: url, max: 5 });
	const dbInstance = drizzle(pool, { schema }) as DbInstance;
	pool.on('error', (err) => invalidateDb(pool, err));
	return { db: dbInstance, pool };
}

export const db = new Proxy({} as DbInstance, {
	get(_target, prop) {
		if (!cachedDb) cachedDb = buildDb();
		const value = (cachedDb.db as unknown as Record<string | symbol, unknown>)[prop as string];
		return typeof value === 'function' ? value.bind(cachedDb.db) : value;
	},
}) as DbInstance;

export * from './schema';
