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
const MIGRATION_LOCK = 'manawg:drizzle-migrate';

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

function validateSupabaseDirectUrl(url, label) {
	validateDatabaseUrl(url, label);
	const parsed = new URL(url);
	if (
		!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
		!parsed.hostname.toLowerCase().endsWith('.supabase.co') ||
		parsed.port !== '5432'
	) {
		throw new Error(`${label} must be a direct Supabase PostgreSQL connection on port 5432.`);
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
		validateDatabaseUrl(direct, 'POSTGRES_URL/DATABASE_URL');
		return direct;
	}

	const direct = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL_UNPOOLED;
	if (direct) {
		validateDatabaseUrl(direct, 'POSTGRES_URL_NON_POOLING/DATABASE_URL_UNPOOLED');
		return direct;
	}

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

function expectedSchema(snapshotTag) {
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

export function expectedBaselineSchema() {
	return expectedSchema(BASELINE_TAG);
}

const normalizeSql = (value) =>
	String(value ?? '')
		.toLowerCase()
		.replace(/"([^"\n]+)"/g, '$1')
		.replace(/::[a-z ]+(?:\[\])?/g, '')
		.replace(/\s+/g, '');

const normalizeType = (type) => normalizeSql(type).replace('charactervarying', 'varchar');
const normalizeDefault = (value) => normalizeSql(value).replace(/^\((.*)\)$/, '$1');
const normalizeCheck = (value, tableName) =>
	normalizeSql(value)
		.replace(/notvalid/g, '')
		.replace(/^check\((.*)\)$/, '$1')
		.replaceAll(`${tableName}.`, '')
		.replace(/(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)in\(([^)]*)\)/g, '$1=any(array[$2])')
		.replace(/[()]/g, '');
const sameColumns = (actual, expected) => actual?.join('\u0000') === expected.join('\u0000');
const foreignKeyAction = {
	a: 'no action',
	r: 'restrict',
	c: 'cascade',
	n: 'set null',
	d: 'set default',
};
const normalizeIndexPart = (value) =>
	String(value ?? '')
		.toLowerCase()
		.replace(/"([^"\n]+)"/g, '$1')
		.replace(/(?:public\.)?[a-z_][a-z0-9_]*\./g, '')
		.replace(/[()]/g, '')
		.replace(/\s+/g, '')
		.replace(/nullslast/g, '');
const expectedIndexKeys = (index) =>
	index.columns.map(({ expression, asc, nulls }) =>
		normalizeIndexPart(
			`${expression}${asc ? '' : ' DESC'}${nulls === 'first' ? ' NULLS FIRST' : ''}`,
		),
	);

const ADOPTION_KNOWN_DRIFT = {
	columnNullability: new Set(['shopping_items.normalized_name']),
	columnDefaults: new Set(['expense_reminders.channel']),
	constraints: new Set(['c.expense_reminders.expense_reminders_channel_check']),
	extraColumns: new Set(['push_subscriptions.last_used_at']),
};

const LEGACY_DATA_CHECKS = [
	[
		'announcements.kind',
		`select count(*)::int as count from public.announcements where kind not in ('info', 'question', 'problem', 'request', 'decision')`,
	],
	[
		'announcements.status',
		`select count(*)::int as count from public.announcements where status not in ('open', 'resolved')`,
	],
	[
		'announcements.source',
		`select count(*)::int as count from public.announcements where source not in ('manual', 'system', 'chore_swap', 'expense', 'shopping')`,
	],
	[
		'chores.recurrence_type',
		`select count(*)::int as count from public.chores where recurrence_type not in ('days', 'months')`,
	],
	[
		'expense_splits.amount_cents',
		'select count(*)::int as count from public.expense_splits where amount_cents < 0',
	],
	[
		'expenses.amount_cents',
		'select count(*)::int as count from public.expenses where amount_cents <= 0',
	],
	[
		'wg_chat_messages.kind',
		`select count(*)::int as count from public.wg_chat_messages where kind not in ('text', 'image', 'system')`,
	],
];

async function assertExpectedSchema(
	client,
	snapshotTag,
	failurePrefix,
	{ allowKnownAdoptionDrift = false, rejectUnexpected = false } = {},
) {
	const { rows: columnRows } =
		await client.query(`select rel.relname as table_name, attr.attname as column_name,
		format_type(attr.atttypid, attr.atttypmod) as type, attr.attnotnull as not_null,
		pg_get_expr(def.adbin, def.adrelid) as default_expr, case when attr.attgenerated = 's' then 's' else '' end as generated,
		case when attr.attgenerated = '' then null else pg_get_expr(def.adbin, def.adrelid) end as generation_expr
		from pg_attribute attr join pg_class rel on rel.oid = attr.attrelid
		join pg_namespace ns on ns.oid = rel.relnamespace left join pg_attrdef def on def.adrelid = rel.oid and def.adnum = attr.attnum
		where ns.nspname = 'public' and rel.relkind in ('r', 'p') and attr.attnum > 0 and not attr.attisdropped`);
	const { rows: constraintRows } =
		await client.query(`select con.conname as constraint_name, con.contype as constraint_type, con.convalidated as is_valid, rel.relname as table_name,
		array(select attr.attname::text from unnest(con.conkey) with ordinality as key(attnum, ord) join pg_attribute attr on attr.attrelid = con.conrelid and attr.attnum = key.attnum order by key.ord) as columns,
		foreign_rel.relname as foreign_table_name, foreign_ns.nspname as foreign_schema,
		array(select attr.attname::text from unnest(con.confkey) with ordinality as key(attnum, ord) join pg_attribute attr on attr.attrelid = con.confrelid and attr.attnum = key.attnum order by key.ord) as foreign_columns,
		con.confdeltype as delete_action, con.confupdtype as update_action, pg_get_constraintdef(con.oid, true) as definition
		from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace ns on ns.oid = rel.relnamespace
		left join pg_class foreign_rel on foreign_rel.oid = con.confrelid left join pg_namespace foreign_ns on foreign_ns.oid = foreign_rel.relnamespace
		where ns.nspname = 'public' and con.contype in ('p', 'u', 'c', 'f')`);
	const { rows: indexRows } =
		await client.query(`select rel.relname as table_name, index_rel.relname as index_name, idx.indisunique as is_unique,
		idx.indisvalid as is_valid, idx.indisready as is_ready, method.amname as method,
		array(select pg_get_indexdef(idx.indexrelid, position, true) ||
				case when (idx.indoption[position - 1] & 1) = 1 then ' desc' else '' end ||
				case when (idx.indoption[position - 1] & 2) = 2 then ' nulls first' else '' end
			from generate_series(1, idx.indnkeyatts) as position) as keys,
		pg_get_expr(idx.indpred, idx.indrelid, true) as predicate
		from pg_index idx join pg_class rel on rel.oid = idx.indrelid join pg_class index_rel on index_rel.oid = idx.indexrelid
		join pg_namespace ns on ns.oid = rel.relnamespace join pg_am method on method.oid = index_rel.relam
		where ns.nspname = 'public' and not exists (select 1 from pg_constraint con where con.conindid = idx.indexrelid)`);

	const expected = expectedSchema(snapshotTag);
	const requireValidatedConstraints = Number(snapshotTag.split('_', 1)[0]) >= 9;
	const columns = new Map(columnRows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
	const expectedTables = new Set(expected.map(({ table }) => table));
	const expectedColumns = new Map(
		expected.flatMap((table) =>
			Object.values(table.columns).map((column) => [`${table.table}.${column.name}`, column]),
		),
	);
	const mismatches = [];
	if (rejectUnexpected) {
		for (const tableName of new Set(columnRows.map((row) => row.table_name))) {
			if (!expectedTables.has(tableName)) mismatches.push(`unexpected table public.${tableName}`);
		}
		for (const [key] of columns) {
			const [tableName, columnName] = key.split('.');
			if (
				expectedTables.has(tableName) &&
				!expectedColumns.has(key) &&
				!(
					allowKnownAdoptionDrift &&
					ADOPTION_KNOWN_DRIFT.extraColumns.has(`${tableName}.${columnName}`)
				)
			) {
				mismatches.push(`unexpected column public.${key}`);
			}
		}
	}
	for (const table of expected) {
		for (const column of Object.values(table.columns)) {
			const actual = columns.get(`${table.table}.${column.name}`);
			if (!actual) {
				mismatches.push(`column public.${table.table}.${column.name}`);
				continue;
			}
			if (normalizeType(actual.type) !== normalizeType(column.type)) {
				mismatches.push(`column public.${table.table}.${column.name} type`);
			}
			if (
				actual.not_null !== column.notNull &&
				!(
					allowKnownAdoptionDrift &&
					ADOPTION_KNOWN_DRIFT.columnNullability.has(`${table.table}.${column.name}`)
				)
			)
				mismatches.push(`column public.${table.table}.${column.name} nullability`);
			if (
				!column.generated &&
				normalizeDefault(actual.default_expr) !== normalizeDefault(column.default) &&
				!(
					allowKnownAdoptionDrift &&
					ADOPTION_KNOWN_DRIFT.columnDefaults.has(`${table.table}.${column.name}`)
				)
			) {
				mismatches.push(`column public.${table.table}.${column.name} default`);
			}
			if ((actual.generated === 's') !== Boolean(column.generated)) {
				mismatches.push(`column public.${table.table}.${column.name} generation`);
			} else if (
				column.generated &&
				normalizeSql(actual.generation_expr) !== normalizeSql(column.generated.as)
			) {
				mismatches.push(`column public.${table.table}.${column.name} generation expression`);
			}
		}
	}

	const constraints = new Map(
		constraintRows.map((row) => [
			`${row.constraint_type}.${row.table_name}.${row.constraint_name}`,
			row,
		]),
	);
	if (rejectUnexpected) {
		const expectedNamedConstraints = new Set(
			expected.flatMap((table) => [
				...Object.values(table.compositePrimaryKeys).map(
					(constraint) => `p.${table.table}.${constraint.name}`,
				),
				...Object.values(table.uniqueConstraints).map(
					(constraint) => `u.${table.table}.${constraint.name}`,
				),
				...Object.values(table.checkConstraints).map(
					(constraint) => `c.${table.table}.${constraint.name}`,
				),
				...Object.values(table.foreignKeys).map(
					(constraint) => `f.${table.table}.${constraint.name}`,
				),
			]),
		);
		for (const row of constraintRows) {
			const key = `${row.constraint_type}.${row.table_name}.${row.constraint_name}`;
			const isExpectedSinglePrimaryKey =
				row.constraint_type === 'p' &&
				expected.some(
					(table) =>
						table.table === row.table_name &&
						Object.values(table.columns).some(
							(column) => column.primaryKey && sameColumns(row.columns, [column.name]),
						),
				);
			if (
				!expectedTables.has(row.table_name) ||
				(!expectedNamedConstraints.has(key) &&
					!isExpectedSinglePrimaryKey &&
					!(allowKnownAdoptionDrift && ADOPTION_KNOWN_DRIFT.constraints.has(key)))
			) {
				mismatches.push(`unexpected constraint public.${row.table_name}.${row.constraint_name}`);
			}
		}
	}
	const primaryKeys = constraintRows.filter((row) => row.constraint_type === 'p');
	const findConstraint = (type, table, name) => constraints.get(`${type}.${table}.${name}`);
	for (const table of expected) {
		for (const column of Object.values(table.columns)) {
			if (
				column.primaryKey &&
				!primaryKeys.some(
					(row) =>
						row.table_name === table.table &&
						row.is_valid === true &&
						sameColumns(row.columns, [column.name]),
				)
			) {
				mismatches.push(`primary key public.${table.table}.${column.name}`);
			}
		}
		for (const constraint of Object.values(table.compositePrimaryKeys)) {
			const actual = findConstraint('p', table.table, constraint.name);
			if (!actual || actual.is_valid !== true || !sameColumns(actual.columns, constraint.columns))
				mismatches.push(`primary key public.${table.table}.${constraint.name}`);
		}
		for (const constraint of Object.values(table.uniqueConstraints)) {
			const actual = findConstraint('u', table.table, constraint.name);
			if (!actual || actual.is_valid !== true || !sameColumns(actual.columns, constraint.columns))
				mismatches.push(`unique constraint public.${table.table}.${constraint.name}`);
		}
		for (const constraint of Object.values(table.checkConstraints)) {
			const actual = findConstraint('c', table.table, constraint.name);
			const mismatch =
				!actual ||
				(requireValidatedConstraints && actual.is_valid !== true) ||
				normalizeCheck(actual.definition, table.table) !==
					normalizeCheck(constraint.value, table.table);
			if (
				mismatch &&
				!(
					allowKnownAdoptionDrift &&
					ADOPTION_KNOWN_DRIFT.constraints.has(`c.${table.table}.${constraint.name}`)
				)
			)
				mismatches.push(`check constraint public.${table.table}.${constraint.name}`);
		}
		for (const foreignKey of Object.values(table.foreignKeys)) {
			const actual = findConstraint('f', table.table, foreignKey.name);
			if (
				!actual ||
				actual.is_valid !== true ||
				!sameColumns(actual.columns, foreignKey.columnsFrom) ||
				actual.foreign_table_name !== foreignKey.tableTo ||
				actual.foreign_schema !== 'public' ||
				!sameColumns(actual.foreign_columns, foreignKey.columnsTo) ||
				(foreignKeyAction[actual.delete_action] ?? actual.delete_action) !== foreignKey.onDelete ||
				(foreignKeyAction[actual.update_action] ?? actual.update_action) !== foreignKey.onUpdate
			) {
				mismatches.push(`foreign key public.${table.table}.${foreignKey.name}`);
			}
		}
	}

	const indexes = new Map(indexRows.map((row) => [`${row.table_name}.${row.index_name}`, row]));
	for (const table of expected) {
		for (const index of Object.values(table.indexes)) {
			const actual = indexes.get(`${table.table}.${index.name}`);
			if (
				!actual ||
				actual.is_valid !== true ||
				actual.is_ready !== true ||
				actual.is_unique !== index.isUnique ||
				actual.method !== index.method ||
				!sameColumns(actual.keys?.map(normalizeIndexPart), expectedIndexKeys(index)) ||
				normalizeCheck(actual.predicate, table.table) !== normalizeCheck(index.where, table.table)
			) {
				mismatches.push(`index public.${table.table}.${index.name}`);
			}
		}
	}

	if (mismatches.length) {
		throw new Error(`${failurePrefix} Mismatches: ${mismatches.join(', ')}.`);
	}
}

export async function assertBaselineSchema(client) {
	return assertExpectedSchema(
		client,
		BASELINE_TAG,
		`Refusing to adopt ${BASELINE_TAG}: baseline schema is incomplete. Apply or repair the baseline before retrying.`,
		{ allowKnownAdoptionDrift: true, rejectUnexpected: true },
	);
}

async function assertMigrationLedger(client) {
	if (!(await tableExists(client, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE))) {
		throw new Error('Database check failed: Drizzle migration ledger is missing.');
	}
	const { rows } = await client.query(`select hash from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`);
	const appliedHashes = new Set(rows.map(({ hash }) => hash));
	const missing = JSON.parse(
		fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
	)
		.entries.filter(({ tag }) => !appliedHashes.has(hashMigration(tag)))
		.map(({ tag }) => tag);
	if (missing.length) {
		throw new Error(`Database check failed: missing migrations ${missing.join(', ')}.`);
	}
}

async function verifyDatabase(client) {
	await client.query('select 1');
	const journal = JSON.parse(
		fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
	);
	const latestTag = journal.entries.at(-1)?.tag;
	if (!latestTag) throw new Error('Database check failed: migration journal is empty.');
	await assertExpectedSchema(
		client,
		latestTag,
		`Database check failed: schema does not match ${latestTag}.`,
		{ rejectUnexpected: true },
	);
	await assertMigrationLedger(client);
	for (const [label, query] of LEGACY_DATA_CHECKS) {
		const { rows } = await client.query(query);
		if (Number(rows[0]?.count ?? 0) !== 0) {
			throw new Error(`Database check failed: existing data violates ${label}.`);
		}
	}

	await client.query('begin');
	try {
		await client.query('create temporary table manawg_db_check (id integer)');
		await client.query('insert into manawg_db_check values (1)');
		await client.query('rollback');
	} catch (error) {
		await client.query('rollback').catch(() => undefined);
		throw error;
	}
	const { rows } = await client.query(
		"select to_regclass('pg_temp.manawg_db_check') is null as rolled_back",
	);
	if (rows[0]?.rolled_back !== true) {
		throw new Error('Database check failed: transaction rollback was not observed.');
	}
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
	const connectionString = resolveConnectionString();
	validateSupabaseDirectUrl(connectionString, 'Database migration connection');
	const pool = new pg.Pool({ connectionString, max: 1 });
	const client = await pool.connect();
	let locked = false;
	try {
		await client.query('select pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK]);
		locked = true;
		if (process.argv.includes('--check')) {
			await verifyDatabase(client);
			console.error('[migrate] Database check passed.');
			return;
		}

		const hasSchema = await tableExists(client, 'public', SENTINEL_TABLE);
		const baselineHash = hashMigration(BASELINE_TAG);
		const needsAdoption = hasSchema && !(await ledgerHasBaseline(client, baselineHash));

		if (needsAdoption) {
			await assertBaselineSchema(client);
			console.error(
				`[migrate] Existing schema without this baseline in the ledger — recording ${BASELINE_TAG} as applied.`,
			);
			await adoptBaseline(client);
		}

		const db = drizzle(client);
		await migrate(db, { migrationsFolder });
		console.error('[migrate] Up to date.');
	} finally {
		try {
			if (locked) await client.query('select pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK]);
		} finally {
			client.release();
			await pool.end();
		}
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error('[migrate] Failed:', err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
