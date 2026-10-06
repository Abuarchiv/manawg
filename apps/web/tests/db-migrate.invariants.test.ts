import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';

const schema = await import('../src/core/db/schema.ts');
const {
	ALLOWED_SECURITY_DEFINER_FUNCTIONS,
	MEMBER_WG_INVARIANT_FUNCTIONS,
	MEMBER_WG_INVARIANT_TRIGGERS,
} = await import('../scripts/db-migrate/catalog-contract.mjs');

const MEMBERS_TABLE = 'wg_members';
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

interface TableReference {
	table: string;
	columns: string[];
}

interface SchemaTable {
	columns: string[];
	references: TableReference[];
}

interface TriggerRow {
	table_name: string;
	trigger_name: string;
	function_name: string;
	args: string[];
}

function schemaTables(): Map<string, SchemaTable> {
	const tables = new Map<string, SchemaTable>();
	for (const value of Object.values(schema)) {
		if (!is(value, PgTable)) continue;
		const config = getTableConfig(value);
		tables.set(config.name, {
			columns: config.columns.map((column) => column.name),
			references: config.foreignKeys.map((foreignKey) => {
				const reference = foreignKey.reference();
				return {
					table: getTableConfig(reference.foreignTable).name,
					columns: reference.columns.map((column) => column.name),
				};
			}),
		});
	}
	return tables;
}

/**
 * A table belongs to one WG when it carries wg_id or references another
 * WG-owned row. wg_members is the anchor the triggers check against, and a
 * table that only references a member inherits that member's WG unambiguously.
 */
function wgScopedTables(tables: Map<string, SchemaTable>): Set<string> {
	const scoped = new Set(
		[...tables].filter(([, table]) => table.columns.includes('wg_id')).map(([name]) => name),
	);
	scoped.delete(MEMBERS_TABLE);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [name, table] of tables) {
			if (scoped.has(name) || name === MEMBERS_TABLE) continue;
			if (table.references.some((reference) => scoped.has(reference.table))) {
				scoped.add(name);
				grew = true;
			}
		}
	}
	return scoped;
}

function migrationTriggers() {
	const pattern =
		/CREATE TRIGGER (\w+)\s+BEFORE INSERT OR UPDATE ON public\.(\w+)\s+FOR EACH ROW EXECUTE FUNCTION public\.(\w+)\(([^)]*)\)/g;
	const triggers: TriggerRow[] = [];
	for (const file of fs
		.readdirSync(migrationsDir)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
		for (const [
			,
			trigger_name = '',
			table_name = '',
			function_name = '',
			args = '',
		] of sql.matchAll(pattern)) {
			triggers.push({
				table_name,
				trigger_name,
				function_name,
				args: [...args.matchAll(/'([^']+)'/g)].map(([, arg = '']) => arg),
			});
		}
	}
	return triggers;
}

test('every WG-scoped table that references a member has an invariant trigger', () => {
	const tables = schemaTables();
	const covered = new Set(MEMBER_WG_INVARIANT_TRIGGERS.map(({ table_name }) => table_name));
	const missing = [...wgScopedTables(tables)].filter(
		(name) =>
			(tables.get(name)?.references ?? []).some((reference) => reference.table === MEMBERS_TABLE) &&
			!covered.has(name),
	);
	assert.deepEqual(
		missing,
		[],
		'add a member/WG trigger migration and list it in scripts/db-migrate/catalog-contract.mjs',
	);
});

test('invariant triggers on tables with wg_id check exactly their member columns', () => {
	const tables = schemaTables();
	for (const expected of MEMBER_WG_INVARIANT_TRIGGERS) {
		const table = tables.get(expected.table_name);
		assert.ok(table, `${expected.table_name} exists in schema.ts`);
		const memberColumns = table.references
			.filter((reference) => reference.table === MEMBERS_TABLE)
			.flatMap((reference) => reference.columns);
		assert.ok(memberColumns.length > 0, `${expected.table_name} references a member`);
		if (table.columns.includes('wg_id')) {
			assert.deepEqual(
				[...expected.args].sort(),
				[...memberColumns].sort(),
				`${expected.trigger_name} arguments`,
			);
		} else {
			assert.deepEqual(
				expected.args,
				[],
				`${expected.trigger_name} resolves the WG via its parent`,
			);
		}
	}
});

test('the invariant list matches the triggers created by the migrations', () => {
	const sortByName = (rows: readonly TriggerRow[]) =>
		[...rows].sort((left, right) => left.trigger_name.localeCompare(right.trigger_name));
	assert.deepEqual(sortByName(migrationTriggers()), sortByName(MEMBER_WG_INVARIANT_TRIGGERS));
});

test('every invariant function is used by a trigger and is the only SECURITY DEFINER allowance', () => {
	const used = new Set(MEMBER_WG_INVARIANT_TRIGGERS.map(({ function_name }) => function_name));
	assert.deepEqual([...used].sort(), [...MEMBER_WG_INVARIANT_FUNCTIONS].sort());
	assert.deepEqual([...ALLOWED_SECURITY_DEFINER_FUNCTIONS].sort(), [...used].sort());
});
