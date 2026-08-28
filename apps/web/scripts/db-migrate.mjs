#!/usr/bin/env node
/**
 * Apply pending Drizzle migrations, with one-time adoption of a database that
 * predates the migration chain.
 *
 * History: the schema used to be synced by hand with `drizzle-kit push`, so the
 * SQL files in `drizzle/` drifted into fiction — five tables never had a
 * CREATE TABLE, yet later files ran UPDATE and CREATE INDEX against them. The
 * chain could not replay on an empty database. It was replaced by a single
 * `0000_baseline.sql` generated from `schema.ts`, which is verified to replay
 * cleanly.
 *
 * That leaves one problem: the existing databases already have all 24 tables,
 * but their migration ledger does not record THIS baseline. Some are empty;
 * production still carries the nine rows of the superseded push-era chain.
 * Either way, running the baseline against them would fail on the first CREATE
 * TABLE. So when the schema is already present but the baseline hash is not yet
 * in the ledger, this script records the baseline as applied instead of
 * executing it — the standard "adopt an existing database" move. The baseline's
 * timestamp is newer than any superseded row, so it sorts as the latest entry
 * and drizzle then skips the baseline and runs only the forward migrations. The
 * dead rows are left in place: they reference a chain that no longer exists and
 * changing which migration is "latest" is all that matters.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
/** Any table that only exists once the baseline has been applied. */
const SENTINEL_TABLE = 'wgs';
const BASELINE_TAG = '0000_baseline';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(scriptDir, '..', 'drizzle');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

function validateDatabaseUrl(url, label) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`${label} is not a valid URL.`);
	}
	if (parsed.port === '6543') {
		throw new Error(
			`${label} must not use port 6543 (Supavisor Transaction Pooler). Use port 5432 or omit the port for local/Direct connections.`,
		);
	}
	const host = parsed.hostname.toLowerCase();
	const isLocal = LOCAL_HOSTS.has(host) || host.endsWith('.local');
	if (!isLocal && !parsed.port) {
		throw new Error(`${label} must specify a port for remote connections.`);
	}
}

/**
 * Turn a Neon pooled host into its direct one. Neon's pooled endpoint is the
 * direct endpoint with a `-pooler` label inserted:
 *   ep-xxx-pooler.region.aws.neon.tech  ->  ep-xxx.region.aws.neon.tech
 * A URL that has no such label (a non-Neon or already-direct host) is returned
 * untouched.
 */
function toDirectEndpoint(url) {
	try {
		const parsed = new URL(url);
		parsed.hostname = parsed.hostname.replace(/-pooler\./, '.');
		return parsed.toString();
	} catch {
		return url;
	}
}

function resolveConnectionString() {
	const migrationUrl = process.env.DATABASE_MIGRATION_URL;
	if (migrationUrl) {
		validateDatabaseUrl(migrationUrl, 'DATABASE_MIGRATION_URL');
		return migrationUrl;
	}

	const pooled = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
	if (pooled) {
		const direct = toDirectEndpoint(pooled);
		const parsed = new URL(direct);
		if (parsed.port === '6543') {
			throw new Error(
				'DDL uses a Supabase Transaction Pooler URL on port 6543 without DATABASE_MIGRATION_URL. Set DATABASE_MIGRATION_URL to the direct connection on port 5432.',
			);
		}
		return direct;
	}

	const direct = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL_UNPOOLED;
	if (direct) return direct;

	throw new Error('No database URL. Set DATABASE_MIGRATION_URL, POSTGRES_URL or DATABASE_URL.');
}

function readJournalEntry(tag) {
	const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
	const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
	const entry = journal.entries.find((it) => it.tag === tag);
	if (!entry) throw new Error(`Journal has no entry tagged "${tag}".`);
	return entry;
}

/** Must match drizzle's own hash: sha256 over the raw file contents. */
function hashMigration(tag) {
	const sql = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), 'utf8');
	return crypto.createHash('sha256').update(sql).digest('hex');
}

async function tableExists(client, schema, table) {
	const { rows } = await client.query(
		'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
		[schema, table],
	);
	return rows.length > 0;
}

/**
 * Has this exact baseline already been recorded as applied? An empty ledger and
 * a ledger that only holds the superseded push-era chain both answer "no" — both
 * still need adoption.
 */
async function ledgerHasBaseline(client, hash) {
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
async function adoptBaseline(client) {
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

async function main() {
	const pool = new pg.Pool({ connectionString: resolveConnectionString(), max: 1 });
	const client = await pool.connect();
	try {
		const hasSchema = await tableExists(client, 'public', SENTINEL_TABLE);
		const baselineHash = hashMigration(BASELINE_TAG);
		const needsAdoption = hasSchema && !(await ledgerHasBaseline(client, baselineHash));

		if (needsAdoption) {
			console.error(
				`[migrate] Existing schema without this baseline in the ledger — recording ${BASELINE_TAG} as applied.`,
			);
			await adoptBaseline(client);
		}

		const db = drizzle(client);
		await migrate(db, { migrationsFolder });
		console.error('[migrate] Up to date.');
	} finally {
		client.release();
		await pool.end();
	}
}

main().catch((err) => {
	console.error('[migrate] Failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
