/**
 * Stand-ins for drizzle-orm's filter operators that build an inspectable predicate tree, plus an
 * evaluator that applies such a tree to an in-memory row. Tests mock `drizzle-orm` with
 * `{ ...realDrizzle, ...predicateOperators }` and then assert which rows a query's filter keeps,
 * instead of matching the generated SQL text.
 */

export type Predicate =
	| { kind: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; column: unknown; value: unknown }
	| { kind: 'in'; column: unknown; values: readonly unknown[] }
	| { kind: 'null' | 'notNull'; column: unknown }
	| { kind: 'and' | 'or'; values: Predicate[] }
	| { kind: 'not'; value: Predicate };

const compare =
	(kind: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte') =>
	(column: unknown, value: unknown): Predicate => ({ kind, column, value });

/** Drizzle drops `undefined` operands from and/or; the stand-ins do the same. */
const present = (values: (Predicate | undefined)[]) =>
	values.filter((value): value is Predicate => value !== undefined);

export const predicateOperators = {
	eq: compare('eq'),
	ne: compare('ne'),
	gt: compare('gt'),
	gte: compare('gte'),
	lt: compare('lt'),
	lte: compare('lte'),
	inArray: (column: unknown, values: readonly unknown[]): Predicate => ({
		kind: 'in',
		column,
		values,
	}),
	isNull: (column: unknown): Predicate => ({ kind: 'null', column }),
	isNotNull: (column: unknown): Predicate => ({ kind: 'notNull', column }),
	and: (...values: (Predicate | undefined)[]): Predicate => ({
		kind: 'and',
		values: present(values),
	}),
	or: (...values: (Predicate | undefined)[]): Predicate => ({
		kind: 'or',
		values: present(values),
	}),
	not: (value: Predicate): Predicate => ({ kind: 'not', value }),
};

const comparable = (value: unknown) => (value instanceof Date ? value.getTime() : value);

/**
 * Applies a predicate tree to `row`. Column operands are resolved through `table`: the row field
 * of a column is the table property that holds it (`table.startsAt` reads `row.startsAt`).
 */
export function rowMatches(
	table: object,
	row: Record<string, unknown>,
	predicate: Predicate | undefined,
): boolean {
	if (predicate === undefined) return true;
	const field = (column: unknown) => {
		const entry = Object.entries(table).find(([, value]) => value === column);
		if (!entry) throw new Error('predicate references a column outside the table');
		return comparable(row[entry[0]] ?? null);
	};
	switch (predicate.kind) {
		case 'and':
			return predicate.values.every((value) => rowMatches(table, row, value));
		case 'or':
			return predicate.values.some((value) => rowMatches(table, row, value));
		case 'not':
			return !rowMatches(table, row, predicate.value);
		case 'null':
			return field(predicate.column) === null;
		case 'notNull':
			return field(predicate.column) !== null;
		case 'in':
			return predicate.values.map(comparable).includes(field(predicate.column));
	}
	const actual = field(predicate.column);
	const expected = comparable(predicate.value);
	// SQL comparisons with NULL are never true.
	if (actual === null || expected === null) return false;
	switch (predicate.kind) {
		case 'eq':
			return actual === expected;
		case 'ne':
			return actual !== expected;
		case 'gt':
			return (actual as number) > (expected as number);
		case 'gte':
			return (actual as number) >= (expected as number);
		case 'lt':
			return (actual as number) < (expected as number);
		case 'lte':
			return (actual as number) <= (expected as number);
	}
}
