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

let cachedDb: TransactionalDb | null = null;

function buildTransactionalDb(): TransactionalDb {
	const url = resolveTransactionConnectionString();
	const pool = new Pool({ connectionString: url, max: 1 });
	pool.on('error', (err: unknown) => console.error('[db/transaction] pool error', err));
	return drizzle(pool, { schema }) as unknown as TransactionalDb;
}

export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
	if (!cachedDb) cachedDb = buildTransactionalDb();
	return cachedDb.transaction(fn);
}
