import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { resolveTransactionConnectionString } from './connection';
import * as schema from './schema';

export { TransactionAbort } from './transaction-abort';

export type DbTransaction = PgTransaction<
	NodePgQueryResultHKT,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>;

interface TransactionalDb {
	transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T>;
}

interface CachedTransactionalDb {
	db: TransactionalDb;
	pool: Pool;
}

let cachedDb: CachedTransactionalDb | null = null;

function invalidateTransactionalDb(pool: Pool, err: Error): void {
	if (cachedDb?.pool !== pool) return;
	cachedDb = null;
	console.error('[db/transaction] Pool error; invalidating connection pool:', err);
	void pool.end().catch((endError: unknown) => {
		console.error('[db/transaction] Pool shutdown failed:', endError);
	});
}

function buildTransactionalDb(): CachedTransactionalDb {
	const url = resolveTransactionConnectionString();
	const pool = new Pool({ connectionString: url, max: 5 });
	const drizzleDb = drizzle(pool, { schema });
	// A typed wrapper instead of `as unknown as TransactionalDb`: the cast
	// used to hide any drift between drizzle's real transaction signature and
	// this module's expectation. If drizzle changes its API, this assignment
	// now fails at compile time instead of at runtime.
	const dbInstance: TransactionalDb = {
		transaction: (fn) => drizzleDb.transaction(fn),
	};
	pool.on('error', (err) => invalidateTransactionalDb(pool, err));
	return { db: dbInstance, pool };
}

export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
	if (!cachedDb) cachedDb = buildTransactionalDb();
	return cachedDb.db.transaction(fn);
}
