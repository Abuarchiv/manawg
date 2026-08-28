import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveConnectionString } from './connection';
import * as schema from './schema';

type DbInstance = Omit<NodePgDatabase<typeof schema>, 'transaction'>;

let cachedDb: DbInstance | null = null;

function buildDb(): DbInstance {
	const url = resolveConnectionString();
	const pool = new Pool({ connectionString: url, max: 1 });
	pool.on('error', (err) => {
		console.error('[db] Pool error:', err.message);
	});
	return drizzle(pool, { schema }) as DbInstance;
}

export const db = new Proxy({} as DbInstance, {
	get(_target, prop) {
		if (!cachedDb) cachedDb = buildDb();
		const value = (cachedDb as unknown as Record<string | symbol, unknown>)[prop as string];
		return typeof value === 'function' ? value.bind(cachedDb) : value;
	},
}) as DbInstance;

export * from './schema';
