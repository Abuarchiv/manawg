/**
 * Compares the live `public` schema (columns, constraints, indexes) with a drizzle-kit snapshot.
 */

import { expectedSchema } from './migrations.mjs';
import {
	expectedIndexKeys,
	foreignKeyAction,
	normalizeCheck,
	normalizeDefault,
	normalizeIndexPart,
	normalizeSql,
	normalizeType,
	sameColumns,
} from './schema-normalize.mjs';

/**
 * Throws `${failurePrefix} Mismatches: ...` when the catalog differs from `snapshotTag`.
 * `knownDrift` lists reviewed differences to tolerate (see legacy-adoption.mjs); with
 * `rejectUnexpected`, tables, columns and constraints missing from the snapshot also fail.
 */
export async function assertExpectedSchema(
	client,
	snapshotTag,
	failurePrefix,
	{ knownDrift = null, rejectUnexpected = false } = {},
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
				!knownDrift?.extraColumns.has(`${tableName}.${columnName}`)
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
				!knownDrift?.columnNullability.has(`${table.table}.${column.name}`)
			)
				mismatches.push(`column public.${table.table}.${column.name} nullability`);
			if (
				!column.generated &&
				normalizeDefault(actual.default_expr) !== normalizeDefault(column.default) &&
				!knownDrift?.columnDefaults.has(`${table.table}.${column.name}`)
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
					!knownDrift?.constraints.has(key))
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
			if (actual?.is_valid !== true || !sameColumns(actual.columns, constraint.columns))
				mismatches.push(`primary key public.${table.table}.${constraint.name}`);
		}
		for (const constraint of Object.values(table.uniqueConstraints)) {
			const actual = findConstraint('u', table.table, constraint.name);
			if (actual?.is_valid !== true || !sameColumns(actual.columns, constraint.columns))
				mismatches.push(`unique constraint public.${table.table}.${constraint.name}`);
		}
		for (const constraint of Object.values(table.checkConstraints)) {
			const actual = findConstraint('c', table.table, constraint.name);
			const mismatch =
				!actual ||
				(requireValidatedConstraints && actual.is_valid !== true) ||
				normalizeCheck(actual.definition, table.table) !==
					normalizeCheck(constraint.value, table.table);
			if (mismatch && !knownDrift?.constraints.has(`c.${table.table}.${constraint.name}`))
				mismatches.push(`check constraint public.${table.table}.${constraint.name}`);
		}
		for (const foreignKey of Object.values(table.foreignKeys)) {
			const actual = findConstraint('f', table.table, foreignKey.name);
			if (
				actual?.is_valid !== true ||
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
				actual?.is_valid !== true ||
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
