import { mock } from 'node:test';

/**
 * A `drizzle-orm` stand-in whose query helpers return plain data, so a fake table can evaluate a
 * module's predicates the way Postgres would. Columns are whatever the fake schema uses (usually
 * the row property name). `sql` keeps its template text with `?` in place of each value.
 */
export interface SqlNode {
	op: string;
	args: unknown[];
	text?: string;
	as: (alias: string) => SqlNode;
	mapWith: (decoder: unknown) => SqlNode;
}

/** Shared methods, so two equal conditions stay deep-equal. */
const nodeMethods = {
	as(this: SqlNode): SqlNode {
		return this;
	},
	mapWith(this: SqlNode): SqlNode {
		return this;
	},
};

function node(op: string, args: unknown[], text?: string): SqlNode {
	return Object.assign(Object.create(nodeMethods), {
		op,
		args,
		...(text === undefined ? {} : { text }),
	}) as SqlNode;
}

const operator =
	(op: string) =>
	(...args: unknown[]): SqlNode =>
		node(op, args);

function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlNode {
	return node('sql', values, strings.join('?'));
}
sql.raw = (text: string): SqlNode => node('sql', [], text);

export const drizzleData = {
	and: (...parts: unknown[]) => node('and', parts.filter(Boolean)),
	or: (...parts: unknown[]) => node('or', parts.filter(Boolean)),
	eq: operator('eq'),
	ne: operator('ne'),
	gt: operator('gt'),
	gte: operator('gte'),
	lt: operator('lt'),
	lte: operator('lte'),
	isNull: operator('isNull'),
	isNotNull: operator('isNotNull'),
	inArray: operator('inArray'),
	asc: operator('asc'),
	desc: operator('desc'),
	count: operator('count'),
	sql,
	getTableColumns: (table: object) => ({ ...table }),
	relations: () => ({}),
};

/** Mock `drizzle-orm` for the module graph under test; `overrides` replace single helpers. */
export function mockDrizzle(overrides: Record<string, unknown> = {}): void {
	mock.module('drizzle-orm', { namedExports: { ...drizzleData, ...overrides } });
}

export function isSqlNode(value: unknown): value is SqlNode {
	return value !== null && typeof value === 'object' && 'op' in value && 'args' in value;
}

function sameValue(left: unknown, right: unknown): boolean {
	if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
	return left === right;
}

function compare(left: unknown, right: unknown): number {
	const a = left instanceof Date ? left.getTime() : (left as number);
	const b = right instanceof Date ? right.getTime() : (right as number);
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Evaluates a condition built by {@link drizzleData} against a row keyed by column. `sqlMatch`
 * handles raw `sql` fragments; without it a raw fragment throws so a test notices it.
 */
export function rowMatches(
	row: Record<string, unknown>,
	condition: unknown,
	sqlMatch?: (row: Record<string, unknown>, fragment: SqlNode) => boolean,
): boolean {
	if (condition === undefined || condition === null) return true;
	if (!isSqlNode(condition)) throw new Error(`unsupported condition ${String(condition)}`);
	const [column, value] = condition.args as [string, unknown];
	// SQL comparisons with NULL are never true.
	const present = row[column] !== null && row[column] !== undefined;
	switch (condition.op) {
		case 'and':
			return condition.args.every((part) => rowMatches(row, part, sqlMatch));
		case 'or':
			return condition.args.some((part) => rowMatches(row, part, sqlMatch));
		case 'eq':
			return sameValue(row[column], value);
		case 'ne':
			return !sameValue(row[column], value);
		case 'gt':
			return present && compare(row[column], value) > 0;
		case 'gte':
			return present && compare(row[column], value) >= 0;
		case 'lt':
			return present && compare(row[column], value) < 0;
		case 'lte':
			return present && compare(row[column], value) <= 0;
		case 'isNull':
			return !present;
		case 'isNotNull':
			return present;
		case 'inArray':
			return (value as unknown[]).some((candidate) => sameValue(row[column], candidate));
		case 'sql':
			if (sqlMatch) return sqlMatch(row, condition);
			throw new Error(`unsupported sql: ${condition.text}`);
		default:
			throw new Error(`unsupported operator ${condition.op}`);
	}
}

/** `select(fields)` over rows keyed by column: each field reads the row property it names. */
export function project(
	rows: readonly Record<string, unknown>[],
	fields: Record<string, unknown>,
): Record<string, unknown>[] {
	return rows.map((row) =>
		Object.fromEntries(
			Object.entries(fields).map(([alias, column]) => [alias, row[column as string]]),
		),
	);
}

/** `orderBy(asc(...), desc(...))` with Postgres defaults: NULL sorts as the largest value. */
export function orderRows<R extends Record<string, unknown>>(rows: readonly R[], orders: unknown[]): R[] {
	const key = (value: unknown) =>
		value === null || value === undefined
			? Number.POSITIVE_INFINITY
			: value instanceof Date
				? value.getTime()
				: (value as number);
	return [...rows].sort((a, b) => {
		for (const order of orders) {
			if (!isSqlNode(order)) continue;
			const column = order.args[0] as string;
			const left = key(a[column]);
			const right = key(b[column]);
			if (left === right) continue;
			const ascending = left < right ? -1 : 1;
			return order.op === 'desc' ? -ascending : ascending;
		}
		return 0;
	});
}

/** The value a condition compares `column` with, searched through nested `and`/`or`. */
export function conditionArg(condition: unknown, op: string, column: unknown): unknown {
	if (!isSqlNode(condition)) return undefined;
	if (condition.op === op && condition.args[0] === column) return condition.args[1];
	for (const part of condition.args) {
		const found = conditionArg(part, op, column);
		if (found !== undefined) return found;
	}
	return undefined;
}
