import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBaselineSchema, expectedBaselineSchema } from './db-migrate.mjs';

const actionCode = {
	'no action': 'a',
	restrict: 'r',
	cascade: 'c',
	'set null': 'n',
	'set default': 'd',
};
const schema = expectedBaselineSchema();
const canonical = { columns: [], constraints: [], indexes: [] };
for (const table of schema) {
	for (const column of Object.values(table.columns)) {
		canonical.columns.push({
			table_name: table.table,
			column_name: column.name,
			type: column.type,
			not_null: column.notNull,
			default_expr: column.default ?? null,
			generated: column.generated?.type === 'stored' ? 's' : '',
			generation_expr: column.generated?.as ?? null,
		});
		if (column.primaryKey)
			canonical.constraints.push({
				table_name: table.table,
				constraint_type: 'p',
				columns: [column.name],
				is_valid: true,
			});
	}
	for (const constraint of Object.values(table.compositePrimaryKeys))
		canonical.constraints.push({
			...constraint,
			table_name: table.table,
			constraint_name: constraint.name,
			constraint_type: 'p',
			is_valid: true,
		});
	for (const constraint of Object.values(table.uniqueConstraints))
		canonical.constraints.push({
			...constraint,
			table_name: table.table,
			constraint_name: constraint.name,
			constraint_type: 'u',
			is_valid: true,
		});
	for (const constraint of Object.values(table.checkConstraints))
		canonical.constraints.push({
			table_name: table.table,
			constraint_name: constraint.name,
			constraint_type: 'c',
			definition: constraint.value,
			is_valid: true,
		});
	for (const foreignKey of Object.values(table.foreignKeys))
		canonical.constraints.push({
			table_name: table.table,
			constraint_name: foreignKey.name,
			constraint_type: 'f',
			columns: foreignKey.columnsFrom,
			foreign_table_name: foreignKey.tableTo,
			foreign_schema: 'public',
			foreign_columns: foreignKey.columnsTo,
			delete_action: actionCode[foreignKey.onDelete],
			update_action: actionCode[foreignKey.onUpdate],
			is_valid: true,
		});
	for (const index of Object.values(table.indexes))
		canonical.indexes.push({
			table_name: table.table,
			index_name: index.name,
			is_unique: index.isUnique,
			is_valid: true,
			is_ready: true,
			method: index.method,
			keys: index.columns.map(
				({ expression, asc, nulls }) =>
					`${expression}${asc ? '' : ' DESC'}${nulls === 'first' ? ' NULLS FIRST' : ''}`,
			),
			predicate: index.where ?? null,
		});
}

const clientFor = ({
	columns = canonical.columns,
	constraints = canonical.constraints,
	indexes = canonical.indexes,
} = {}) => ({
	query: async (query) => {
		if (query.includes('from pg_attribute')) return { rows: columns };
		if (query.includes('from pg_index')) return { rows: indexes };
		return { rows: constraints };
	},
});

test('baseline adoption refuses structural mismatches', async () => {
	const client = {
		query: async (query) => {
			if (query.includes('from pg_attribute')) {
				return {
					rows: [
						{
							table_name: 'wgs',
							column_name: 'share_code',
							type: 'integer',
							not_null: true,
							default_expr: null,
							generated: '',
							generation_expr: null,
						},
					],
				};
			}
			return { rows: [] };
		},
	};

	await assert.rejects(
		() => assertBaselineSchema(client),
		/column public\.wgs\.share_code type.*index public\.wgs\.wgs_share_code_idx/,
	);
});

test('baseline adoption refuses invalid constraints and indexes', async () => {
	const constraints = canonical.constraints.map((row) =>
		row.constraint_type === 'f' ? { ...row, is_valid: false, foreign_schema: 'other' } : row,
	);
	const indexes = canonical.indexes.map((row) => ({ ...row, is_ready: false }));

	await assert.rejects(
		() => assertBaselineSchema(clientFor({ constraints, indexes })),
		/foreign key public\..*index public\./,
	);
});

test('baseline adoption accepts the canonical snapshot schema', async () => {
	await assert.doesNotReject(() => assertBaselineSchema(clientFor()));
});
