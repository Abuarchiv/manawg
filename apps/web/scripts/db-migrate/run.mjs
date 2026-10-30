/**
 * One migrator run. Holds a session-level advisory lock for its whole duration so concurrent runs
 * (CI retries, a second operator) serialize instead of racing on the ledger. `progress.stage` names
 * the step in flight so the CLI can report where a failure happened.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
	previewSessionDatabaseUrl,
	productionSessionDatabaseUrl,
	resolveConnectionString,
	validateSupabaseSessionUrl,
} from './connection.mjs';
import { assertMigrationLedgerPrefix } from './ledger.mjs';
import { acquireMigrationLock, releaseMigrationLock } from './lock.mjs';
import {
	MIGRATIONS_SCHEMA,
	MIGRATIONS_TABLE,
	migrationsFolder,
	tableExists,
} from './migrations.mjs';
import { verifyDatabase } from './verify.mjs';

/** How long one migration statement may wait for a table lock. */
const MIGRATION_LOCK_TIMEOUT = '5s';
/** Any table that only exists once the baseline has been applied. */
const SENTINEL_TABLE = 'wgs';

export async function main(progress) {
	progress.stage = 'connection-config';
	const sourceConnection = resolveConnectionString();
	// A self-hosted stack (scripts/selfhost/setup.mjs) migrates its own PostgreSQL container.
	const selfHosted = process.env.MANAWG_SELF_HOSTED === 'true';
	if (!selfHosted) validateSupabaseSessionUrl(sourceConnection, 'Database migration connection');
	const previewSession = process.env.MANAWG_PREVIEW_CI_SESSION === 'true';
	const productionSession = process.env.MANAWG_PRODUCTION_CI_SESSION === 'true';
	if ([selfHosted, previewSession, productionSession].filter(Boolean).length > 1) {
		throw new Error('Self-hosted, Preview and Production CI sessions are mutually exclusive.');
	}
	const connectionString = previewSession
		? previewSessionDatabaseUrl(sourceConnection)
		: productionSession
			? productionSessionDatabaseUrl(sourceConnection)
			: sourceConnection;
	const pool = new pg.Pool({ connectionString, max: 1 });
	progress.stage = 'connect';
	const client = await pool.connect();
	let locked = false;
	try {
		progress.stage = 'lock';
		await acquireMigrationLock(client);
		locked = true;
		if (process.argv.includes('--check')) {
			progress.stage = 'verify';
			await verifyDatabase(client);
			console.error('[migrate] Database check passed.');
			return;
		}

		progress.stage = 'inspect-schema';
		const hasSchema = await tableExists(client, 'public', SENTINEL_TABLE);
		progress.stage = 'inspect-ledger-table';
		const hasMigrationLedger = await tableExists(client, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE);
		progress.stage = 'inspect-ledger';
		const ledger = hasMigrationLedger ? await assertMigrationLedgerPrefix(client) : null;
		if (ledger && ledger.appliedCount === ledger.entries.length) {
			progress.stage = 'verify';
			await verifyDatabase(client);
			console.error('[migrate] Verified up to date.');
			return;
		}
		// The baseline would fail on existing tables; a schema without a ledger needs a person.
		if (hasSchema && !ledger?.appliedCount) {
			throw new Error(
				'Database check failed: the schema exists but the migration ledger is empty. Restore the ledger before migrating.',
			);
		}
		const db = drizzle(client);
		// DDL waits for an ACCESS EXCLUSIVE (or SHARE) lock and, while waiting,
		// queues every later query on that table behind it. Give up quickly
		// instead: the whole migration rolls back and can simply be re-run.
		progress.stage = 'lock-timeout';
		await client.query(`set lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
		progress.stage = 'migrate';
		await migrate(db, { migrationsFolder });
		console.error('[migrate] Up to date.');
	} finally {
		try {
			if (locked) {
				const previousStage = progress.stage;
				progress.stage = 'unlock';
				let unlockSucceeded = false;
				try {
					await releaseMigrationLock(client);
					unlockSucceeded = true;
				} finally {
					if (unlockSucceeded) progress.stage = previousStage;
				}
			}
		} finally {
			client.release();
			await pool.end();
		}
	}
}
