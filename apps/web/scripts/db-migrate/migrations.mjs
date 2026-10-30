/**
 * The migration chain on disk (`drizzle/`: SQL files, journal, snapshots) and the location of the
 * Drizzle ledger that records which of those files a database has applied.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.join(moduleDir, '..', '..', 'drizzle');

export function readMigrationJournal() {
	const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
	const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
	if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
		throw new Error('Migration journal must contain entries.');
	}

	const tags = new Set();
	let previousWhen = -1;
	for (const [index, entry] of journal.entries.entries()) {
		if (!Number.isInteger(entry.idx) || entry.idx !== index) {
			throw new Error(`Migration journal entry ${index} must use contiguous idx ${index}.`);
		}
		if (
			typeof entry.tag !== 'string' ||
			!/^\d{4}_[a-z0-9_]+$/.test(entry.tag) ||
			tags.has(entry.tag) ||
			!fs.existsSync(path.join(migrationsFolder, `${entry.tag}.sql`))
		) {
			throw new Error(
				`Migration journal entry ${index} has an invalid, duplicate, or missing SQL tag.`,
			);
		}
		if (!Number.isSafeInteger(entry.when) || entry.when <= previousWhen) {
			throw new Error(
				`Migration journal entry ${entry.tag} must have a unique increasing timestamp.`,
			);
		}
		tags.add(entry.tag);
		previousWhen = entry.when;
	}
	const sqlTags = fs
		.readdirSync(migrationsFolder)
		.filter((file) => file.endsWith('.sql'))
		.map((file) => file.slice(0, -'.sql'.length));
	if (sqlTags.length !== tags.size || sqlTags.some((tag) => !tags.has(tag))) {
		throw new Error('Migration journal must list every SQL migration exactly once.');
	}
	return journal;
}

/** Must match drizzle's own hash: sha256 over the raw file contents. */
export function hashMigration(tag) {
	const sql = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), 'utf8');
	return crypto.createHash('sha256').update(sql).digest('hex');
}

export async function tableExists(client, schema, table) {
	const { rows } = await client.query(
		`select 1
		 from pg_catalog.pg_class as c
		 join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
		 where n.nspname = $1
		   and c.relname = $2
		   and c.relkind in ('r', 'p')`,
		[schema, table],
	);
	return rows.length > 0;
}

export function latestAvailableSnapshotTag() {
	const snapshots = fs
		.readdirSync(path.join(migrationsFolder, 'meta'))
		.map((file) => {
			const match = /^(\d+)_snapshot\.json$/.exec(file);
			return match ? { number: Number(match[1]), tag: file.slice(0, -'.json'.length) } : null;
		})
		.filter(Boolean)
		.sort((left, right) => left.number - right.number);
	const latest = snapshots.at(-1);
	if (!latest) throw new Error('Database check failed: no migration snapshot is available.');
	return latest.tag;
}

export function expectedSchema(snapshotTag) {
	const snapshotNumber = snapshotTag.split('_', 1)[0];
	const snapshotPath = path.join(migrationsFolder, 'meta', `${snapshotNumber}_snapshot.json`);
	const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
	return Object.entries(snapshot.tables)
		.filter(([name]) => name.startsWith('public.'))
		.map(([name, table]) => ({
			table: name.slice('public.'.length),
			columns: table.columns,
			indexes: table.indexes,
			foreignKeys: table.foreignKeys,
			compositePrimaryKeys: table.compositePrimaryKeys,
			uniqueConstraints: table.uniqueConstraints,
			checkConstraints: table.checkConstraints,
		}));
}
