/**
 * Filter predicates for route tests whose fake tables are plain `{ table, name }` column objects.
 * The tests mock drizzle-orm's operators to build these predicates, and the fake database applies
 * them to its rows, so a route only sees the rows its query actually selects.
 */

export type Column = { table: string; name: string };

export type Predicate =
	| { kind: 'eq'; column: Column; value: unknown }
	| { kind: 'in'; column: Column; values: unknown[] }
	| { kind: 'null' | 'notNull'; column: Column }
	/** Millisecond-precision version check on `updatedAtPrecise`. */
	| { kind: 'millisEq'; value: unknown }
	/** The next version stamp of an update; it never selects a row. */
	| { kind: 'nextVersion' }
	| { kind: 'and'; values: Predicate[] };

export const columnOperators = {
	eq: (column: Column, value: unknown): Predicate => ({ kind: 'eq', column, value }),
	inArray: (column: Column, values: unknown[]): Predicate => ({ kind: 'in', column, values }),
	isNull: (column: Column): Predicate => ({ kind: 'null', column }),
	isNotNull: (column: Column): Predicate => ({ kind: 'notNull', column }),
	and: (...values: Predicate[]): Predicate => ({ kind: 'and', values }),
};

export function matches(row: Record<string, unknown>, predicate: Predicate): boolean {
	if (predicate.kind === 'and') return predicate.values.every((item) => matches(row, item));
	if (predicate.kind === 'millisEq') {
		return (
			typeof row.updatedAtPrecise === 'string' &&
			predicate.value instanceof Date &&
			new Date(row.updatedAtPrecise).getTime() === predicate.value.getTime()
		);
	}
	if (predicate.kind === 'nextVersion') return false;
	const value = row[predicate.column.name];
	if (predicate.kind === 'eq') {
		if (
			predicate.column.name === 'updatedAt' &&
			typeof row.updatedAtPrecise === 'string' &&
			predicate.value instanceof Date
		) {
			return row.updatedAtPrecise === predicate.value.toISOString();
		}
		return value === predicate.value;
	}
	if (predicate.kind === 'in') return predicate.values.includes(value);
	if (predicate.kind === 'null') return value === null || value === undefined;
	return value !== null && value !== undefined;
}
