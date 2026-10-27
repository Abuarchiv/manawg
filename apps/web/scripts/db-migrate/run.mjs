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
	validateSupabaseDirectUrl,
} from './connection.mjs';
import { assertMigrationLedgerPrefix } from './ledger.mjs';
import { adoptBaseline, assertBaselineSchema, ledgerHasBaseline } from './legacy-adoption.mjs';
import { acquireMigrationLock, releaseMigrationLock } from './lock.mjs';
import {
	BASELINE_TAG,
	MIGRATIONS_SCHEMA,
	MIGRATIONS_TABLE,
	hashMigration,
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
	validateSupabaseDirectUrl(sourceConnection, 'Database migration connection');
	const previewSession = process.env.MANAWG_PREVIEW_CI_SESSION === 'true';
	const productionSession = process.env.MANAWG_PRODUCTION_CI_SESSION === 'true';
	if (previewSession && productionSession) {
		throw new Error('Preview and Production CI sessions are mutually exclusive.');
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
		// Baseline adoption for pre-chain ledgers; legacy-adoption.mjs says when this can go.
		progress.stage = 'inspect-baseline';
		const baselineHash = hashMigration(BASELINE_TAG);
		progress.stage = 'inspect-baseline-ledger';
		const needsAdoption = hasSchema && !(await ledgerHasBaseline(client, baselineHash));

		if (needsAdoption) {
			progress.stage = 'adoption-verify';
			await assertBaselineSchema(client);
			console.error(
				`[migrate] Existing schema without this baseline in the ledger — recording ${BASELINE_TAG} as applied.`,
			);
			progress.stage = 'adopt';
			await adoptBaseline(client);
		}

		progress.stage = 'ledger';
		if (hasMigrationLedger || needsAdoption) await assertMigrationLedgerPrefix(client);
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
