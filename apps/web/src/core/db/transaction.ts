import { type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { closeClientOnQueryTimeout, resolveConnectionString } from './connection';
import * as schema from './schema';

export { withTransaction } from './index';
export { TransactionAbort } from './transaction-abort';

export type DbTransaction = PgTransaction<
	NodePgQueryResultHKT,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>;

/** Acquire before WG/member row locks so capture, cron, and deletion share one lock order. */
export async function lockExpensePayments(tx: DbTransaction, wgId: string): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`expense-payment:${wgId}`}))`);
}

/**
 * Open a bounded transaction on a new connection for resolving an uncertain commit.
 * The fresh connection waits behind the original transaction's advisory lock before reading its durable outcome.
 */
export async function withFreshTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
	const client = new Client({
		connectionString: resolveConnectionString(),
		application_name: 'manawg-account-deletion-status-check',
		connectionTimeoutMillis: 2_000,
		query_timeout: 5_500,
		statement_timeout: 5_000,
	});
	closeClientOnQueryTimeout(client);
	await client.connect();
	try {
		return await drizzle(client, { schema }).transaction(fn);
	} finally {
		await client.end().catch((error: unknown) => {
			console.warn('[db/transaction] Fresh connection shutdown failed:', error);
		});
	}
}
