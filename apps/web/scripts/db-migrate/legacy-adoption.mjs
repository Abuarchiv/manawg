/**
 * Compatibility paths for databases whose ledger predates the current migration chain. Both stay
 * fail-closed: anything not listed here is rejected by ledger.mjs or schema-check.mjs.
 *
 * Baseline adoption: a database that already has the application schema but no `0000_baseline`
 * row in the ledger (an empty ledger, or one holding only rows from before the baseline existed)
 * gets the baseline recorded as applied instead of executed, after its catalog has been verified
 * against the baseline snapshot plus ADOPTION_KNOWN_DRIFT. Delete this path, ADOPTION_KNOWN_DRIFT
 * and the adoption branch in run.mjs once every database the migrator can target (Production,
 * Preview and any long-lived development database) has the `0000_baseline` hash in
 * `drizzle.__drizzle_migrations`.
 *
 * Ledger allowlist: see LEGACY_LEDGER_ALLOWLIST.
 */

import {
	BASELINE_TAG,
	MIGRATIONS_SCHEMA,
	MIGRATIONS_TABLE,
	hashMigration,
	readJournalEntry,
	tableExists,
} from './migrations.mjs';
import { assertExpectedSchema } from './schema-check.mjs';

/**
 * Reviewed historical ledger hashes, each tolerated only with its exact timestamp at its
 * zero-based position in the current journal. `0007_data_api_security` and
 * `0010_enable_public_rls` were edited after Preview had applied them, so that ledger carries the
 * earlier file hashes. Ledger rows are never rewritten, so an entry can only be deleted once no
 * database still holds that hash (for example after the database has been recreated).
 */
export const LEGACY_LEDGER_ALLOWLIST = new Map([
	[
		'88916329fbe6f5e5f4e4174e5db393aa3d7c4516790c4dbf3d1a41301f335aa0',
		{ when: 1788112576655, position: 7 },
	],
	[
		'fb524f9b63dd0b63b84d8d1bf6d916781e7cc206682bf23bdd0106d9e9dbbb0e',
		{ when: 1788436085539, position: 10 },
	],
]);

/** Whether a ledger row outside the canonical chain is an allowlisted historical row. */
export function isAllowedLegacyLedgerRow(hash, createdAt, position) {
	const legacy = LEGACY_LEDGER_ALLOWLIST.get(hash);
	return (
		Boolean(legacy) && createdAt === String(legacy.when) && position === Number(legacy.position)
	);
}

/** Reviewed differences between adopted databases and the baseline snapshot. */
export const ADOPTION_KNOWN_DRIFT = {
	columnNullability: new Set(['shopping_items.normalized_name']),
	columnDefaults: new Set(['expense_reminders.channel']),
	constraints: new Set(['c.expense_reminders.expense_reminders_channel_check']),
	extraColumns: new Set(['push_subscriptions.last_used_at']),
};

export async function assertBaselineSchema(client) {
	return assertExpectedSchema(
		client,
		BASELINE_TAG,
		`Refusing to adopt ${BASELINE_TAG}: baseline schema is incomplete. Apply or repair the baseline before retrying.`,
		{ knownDrift: ADOPTION_KNOWN_DRIFT, rejectUnexpected: true },
	);
}

/**
 * Has this exact baseline already been recorded as applied? An empty ledger and
 * a ledger that only holds the superseded push-era chain both answer "no" — both
 * still need adoption.
 */
export async function ledgerHasBaseline(client, hash) {
	if (!(await tableExists(client, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE))) return false;
	const { rows } = await client.query(
		`select 1 from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} where hash = $1 limit 1`,
		[hash],
	);
	return rows.length > 0;
}

/**
 * Record the baseline as applied without running it. Only called when the
 * schema is already populated, so this describes reality rather than changing
 * it.
 */
export async function adoptBaseline(client) {
	const entry = readJournalEntry(BASELINE_TAG);
	const hash = hashMigration(BASELINE_TAG);
	await client.query(`create schema if not exists ${MIGRATIONS_SCHEMA}`);
	await client.query(
		`create table if not exists ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
			id serial primary key,
			hash text not null,
			created_at bigint
		)`,
	);
	await client.query(
		`insert into ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at) values ($1, $2)`,
		[hash, entry.when],
	);
}
