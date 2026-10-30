import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	assertMigrationLedgerPrefix,
	HISTORICAL_LEDGER_ROWS,
	isHistoricalLedgerRow,
} from '../scripts/db-migrate/ledger.mjs';
import {
	expectedSchema,
	hashMigration,
	latestAvailableSnapshotTag,
	migrationsFolder,
	readMigrationJournal,
} from '../scripts/db-migrate/migrations.mjs';
import { assertExpectedSchema } from '../scripts/db-migrate/schema-check.mjs';
import {
	expectedIndexKeys,
	normalizeCheck,
	normalizeDefault,
	normalizeIndexPart,
	normalizeType,
} from '../scripts/db-migrate/schema-normalize.mjs';

interface SnapshotColumn {
	name: string;
	type: string;
	notNull: boolean;
	primaryKey?: boolean;
	default?: string;
	generated?: { as: string };
}
interface SnapshotKey {
	name: string;
	columns: string[];
}
interface SnapshotTable {
	table: string;
	columns: Record<string, SnapshotColumn>;
	indexes: Record<
		string,
		{
			name: string;
			isUnique: boolean;
			method: string;
			where?: string;
			columns: Array<{ expression: string; asc: boolean; nulls: string }>;
		}
	>;
	foreignKeys: Record<
		string,
		{
			name: string;
			columnsFrom: string[];
			tableTo: string;
			columnsTo: string[];
			onDelete: keyof typeof ACTION_CODES;
			onUpdate: keyof typeof ACTION_CODES;
		}
	>;
	compositePrimaryKeys: Record<string, SnapshotKey>;
	uniqueConstraints: Record<string, SnapshotKey>;
	checkConstraints: Record<string, { name: string; value: string }>;
}
type CatalogRow = Record<string, unknown>;
interface CatalogColumnRow extends CatalogRow {
	table_name: string;
	column_name: string;
}
interface CatalogIndexRow extends CatalogRow {
	table_name: string;
	index_name: string;
}
interface Catalog {
	columns: CatalogColumnRow[];
	constraints: CatalogRow[];
	indexes: CatalogIndexRow[];
}
interface JournalEntry {
	idx: number;
	tag: string;
	when: number;
}
interface LedgerRow {
	id: number;
	hash: string;
	created_at: string;
}

const ACTION_CODES = {
	'no action': 'a',
	restrict: 'r',
	cascade: 'c',
	'set null': 'n',
	'set default': 'd',
};

/** Catalog rows shaped like the migrator's pg_catalog queries, built from a snapshot. */
function catalogFor(snapshotTag: string): Catalog {
	const columns: CatalogColumnRow[] = [];
	const constraints: CatalogRow[] = [];
	const indexes: CatalogIndexRow[] = [];
	const tables: SnapshotTable[] = expectedSchema(snapshotTag);
	for (const table of tables) {
		const base = { table_name: table.table, is_valid: true };
		for (const column of Object.values(table.columns)) {
			columns.push({
				table_name: table.table,
				column_name: column.name,
				type: column.type,
				not_null: column.notNull,
				default_expr: column.generated ? column.generated.as : (column.default ?? null),
				generated: column.generated ? 's' : '',
				generation_expr: column.generated ? column.generated.as : null,
			});
			if (column.primaryKey) {
				constraints.push({
					...base,
					constraint_name: `${table.table}_pkey`,
					constraint_type: 'p',
					columns: [column.name],
				});
			}
		}
		for (const key of Object.values(table.compositePrimaryKeys)) {
			constraints.push({
				...base,
				constraint_name: key.name,
				constraint_type: 'p',
				columns: key.columns,
			});
		}
		for (const key of Object.values(table.uniqueConstraints)) {
			constraints.push({
				...base,
				constraint_name: key.name,
				constraint_type: 'u',
				columns: key.columns,
			});
		}
		for (const check of Object.values(table.checkConstraints)) {
			constraints.push({
				...base,
				constraint_name: check.name,
				constraint_type: 'c',
				columns: [],
				definition: `CHECK (${check.value})`,
			});
		}
		for (const fk of Object.values(table.foreignKeys)) {
			constraints.push({
				...base,
				constraint_name: fk.name,
				constraint_type: 'f',
				columns: fk.columnsFrom,
				foreign_table_name: fk.tableTo,
				foreign_schema: 'public',
				foreign_columns: fk.columnsTo,
				delete_action: ACTION_CODES[fk.onDelete],
				update_action: ACTION_CODES[fk.onUpdate],
			});
		}
		for (const index of Object.values(table.indexes)) {
			indexes.push({
				table_name: table.table,
				index_name: index.name,
				is_unique: index.isUnique,
				is_valid: true,
				is_ready: true,
				method: index.method,
				keys: index.columns.map(
					({ expression, asc, nulls }) =>
						`${expression}${asc ? '' : ' desc'}${nulls === 'first' ? ' nulls first' : ''}`,
				),
				predicate: index.where ?? null,
			});
		}
	}
	return { columns, constraints, indexes };
}

function catalogClient({ columns, constraints, indexes }: Catalog) {
	return {
		query: async (sql: string) => {
			const text = String(sql);
			if (text.includes('format_type(attr.atttypid')) return { rows: columns };
			if (text.includes('pg_get_constraintdef(con.oid')) return { rows: constraints };
			if (text.includes('pg_get_indexdef(')) return { rows: indexes };
			throw new Error(`unexpected query: ${text.slice(0, 80)}`);
		},
	};
}

const canonicalRows = (): LedgerRow[] =>
	(readMigrationJournal().entries as JournalEntry[]).map((entry, index) => ({
		id: index + 1,
		hash: hashMigration(entry.tag),
		created_at: String(entry.when),
	}));

function ledgerClient(rows: Partial<LedgerRow>[], { tableExists = true } = {}) {
	return {
		query: async (sql: string) => {
			const text = String(sql);
			if (text.includes('pg_catalog.pg_class')) return { rows: tableExists ? [{}] : [] };
			if (text.includes('__drizzle_migrations')) return { rows };
			throw new Error(`unexpected query: ${text.slice(0, 80)}`);
		},
	};
}

test('normalizers treat catalog output and snapshot SQL as equal', () => {
	assert.equal(
		normalizeCheck("CHECK ((kind = ANY (ARRAY['info'::text, 'question'::text])))", 'announcements'),
		normalizeCheck(`"announcements"."kind" in ('info', 'question')`, 'announcements'),
	);
	assert.equal(
		normalizeCheck('CHECK ((amount_cents > 0)) NOT VALID', 'expenses'),
		normalizeCheck('"expenses"."amount_cents" > 0', 'expenses'),
	);
	assert.equal(normalizeType('character varying(64)'), normalizeType('varchar(64)'));
	assert.equal(normalizeDefault("('open'::text)"), normalizeDefault("'open'"));
	assert.notEqual(normalizeDefault('now()'), normalizeDefault("'open'"));
	assert.deepEqual(
		['created_at desc', 'id nulls last'].map(normalizeIndexPart),
		expectedIndexKeys({
			columns: [
				{ expression: 'created_at', asc: false, nulls: 'last' },
				{ expression: 'id', asc: true, nulls: 'last' },
			],
		}),
	);
});

test('the journal on disk is contiguous and hashes match the raw SQL files', () => {
	const entries: JournalEntry[] = readMigrationJournal().entries;
	assert.equal(entries[0]?.tag, '0000_baseline');
	for (const [index, entry] of entries.entries()) assert.equal(entry.idx, index);
	const last = entries.at(-1);
	assert.ok(last);
	const sql = fs.readFileSync(path.join(migrationsFolder, `${last.tag}.sql`), 'utf8');
	assert.equal(hashMigration(last.tag), crypto.createHash('sha256').update(sql).digest('hex'));
	const snapshotNumbers = fs
		.readdirSync(path.join(migrationsFolder, 'meta'))
		.map((file) => /^(\d+)_snapshot\.json$/.exec(file)?.[1])
		.filter(Boolean)
		.map(Number);
	assert.equal(Number(latestAvailableSnapshotTag().split('_', 1)[0]), Math.max(...snapshotNumbers));
});

test('ledger prefix counts applied migrations and tolerates a missing table only on request', async () => {
	const rows = canonicalRows();
	assert.equal((await assertMigrationLedgerPrefix(ledgerClient(rows.slice(0, 3)))).appliedCount, 3);
	const missing = await assertMigrationLedgerPrefix(ledgerClient([], { tableExists: false }), {
		requireTable: false,
	});
	assert.equal(missing.appliedCount, 0);
});

test('ledger prefix rejects reordered, mistimed, duplicated and malformed rows', async () => {
	const rows = canonicalRows();
	const [first, second] = rows;
	assert.ok(first && second);
	const cases: Array<[Partial<LedgerRow>[], RegExp]> = [
		[[second], /migration ledger is not a canonical prefix; expected 0000_baseline before/],
		[[{ ...first, created_at: '1' }], /timestamp mismatch for migration 0000_baseline/],
		[[first, { ...first, id: 2 }], /duplicate migration 0000_baseline/],
		[[{ ...first, hash: 'XYZ' }], /invalid migration hash in ledger row 1/],
		[[{ ...first, created_at: 'soon' }], /invalid migration timestamp in ledger row 1/],
	];
	for (const [ledger, message] of cases) {
		await assert.rejects(assertMigrationLedgerPrefix(ledgerClient(ledger)), message);
	}
});

test('allowlisted historical hashes are accepted only at their position and timestamp', async () => {
	const [historical] = [...HISTORICAL_LEDGER_ROWS];
	assert.ok(historical);
	const [hash, { when, position }] = historical;
	assert.equal(isHistoricalLedgerRow(hash, String(when), position), true);
	assert.equal(isHistoricalLedgerRow(hash, String(when), position + 1), false);
	assert.equal(isHistoricalLedgerRow(hash, String(when + 1), position), false);
	assert.equal(isHistoricalLedgerRow('ab'.repeat(32), String(when), position), false);

	const rows = canonicalRows();
	const withHistorical = rows.map((row, index) =>
		index === position ? { ...row, hash, created_at: String(when) } : row,
	);
	assert.equal(
		(await assertMigrationLedgerPrefix(ledgerClient(withHistorical))).appliedCount,
		rows.length,
	);
	const misplaced = [{ id: 1, hash, created_at: String(when) }];
	await assert.rejects(
		assertMigrationLedgerPrefix(ledgerClient(misplaced)),
		/unexpected migration row 1 outside the canonical ledger/,
	);
});

test('schema check accepts a catalog that matches the latest snapshot', async () => {
	const tag = latestAvailableSnapshotTag();
	await assertExpectedSchema(catalogClient(catalogFor(tag)), tag, 'mismatch.', {
		rejectUnexpected: true,
	});
});

test('schema check reports missing, unexpected and invalid objects', async () => {
	const tag = latestAvailableSnapshotTag();
	const catalog = catalogFor(tag);
	const [dropped, ...columns] = catalog.columns;
	const [invalidIndex, ...indexes] = catalog.indexes;
	assert.ok(dropped && invalidIndex);
	const broken: Catalog = {
		columns: [
			...columns,
			{ ...dropped, table_name: 'stray_table', column_name: 'id' },
			{ ...dropped, column_name: 'stray_column' },
		],
		constraints: catalog.constraints,
		indexes: [...indexes, { ...invalidIndex, is_valid: false }],
	};
	await assert.rejects(
		assertExpectedSchema(catalogClient(broken), tag, 'mismatch.', { rejectUnexpected: true }),
		(error: Error) => {
			assert.match(error.message, /^mismatch\. Mismatches: /);
			assert.ok(error.message.includes('unexpected table public.stray_table'));
			assert.ok(
				error.message.includes(`unexpected column public.${dropped.table_name}.stray_column`),
			);
			assert.ok(
				error.message.includes(`column public.${dropped.table_name}.${dropped.column_name}`),
			);
			assert.ok(
				error.message.includes(
					`index public.${invalidIndex.table_name}.${invalidIndex.index_name}`,
				),
			);
			return true;
		},
	);
});
