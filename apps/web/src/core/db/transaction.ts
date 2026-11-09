import { type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { logApiError } from '@/core/infra/observability';
import { closeClientOnQueryTimeout, resolveConnectionString } from './connection';
import * as schema from './schema';

export { withTransaction } from './index';
export { TransactionAbort } from './transaction-abort';

export type DbTransaction = PgTransaction<
	NodePgQueryResultHKT,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>;

/**
 * The WG-wide write lock; the name predates the removal of online payments. Take it before any
 * WG/member row lock so writers, cron jobs, and WG/account deletion share one lock order.
 */
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
	// A dropped socket emits 'error' on an idle or busy client; without a listener it would crash the process.
	client.on('error', (error) => logApiError('[db/transaction] Fresh connection error:', error));
	closeClientOnQueryTimeout(client);
	await client.connect();
	try {
		return await drizzle(client, { schema }).transaction(fn);
	} finally {
		await client.end().catch((error: unknown) => {
			logApiError('[db/transaction] Fresh connection shutdown failed:', error);
		});
	}
}
