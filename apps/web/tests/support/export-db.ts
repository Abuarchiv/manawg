import { mockDb } from './db-mock';
import { type SqlNode, isSqlNode, mockDrizzle, rowMatches } from './drizzle-mock';

/**
 * The tables `composition/export-queries` reads, as a fake database for the WG export route.
 * Every column of a fake table is named after its property, so the data conditions of
 * {@link ./drizzle-mock} can filter rows.
 */
const TABLE_NAMES = [
	'announcementComments',
	'announcements',
	'auditEvents',
	'chores',
	'expensePayments',
	'expenseSplits',
	'expenses',
	'memberAbsences',
	'recurringExpenses',
	'shoppingItems',
	'wgChatMessages',
	'wgEvents',
	'wgMembers',
] as const;

type ExportTable = (typeof TABLE_NAMES)[number];
type Row = Record<string, unknown>;

export interface ExportDbState {
	rowsByTable: Partial<Record<ExportTable, Row[]>>;
	/** A table whose query fails with a message that must never leak into a response or log. */
	failedTable: ExportTable | null;
	/** Filter rows by the queries' conditions; off, every query sees all rows of its table. */
	applyConditions: boolean;
	limits: number[];
	/** Sizes of the id lists passed to `inArray`, in query order. */
	inArrayCalls: number[];
}

export const LEAKED_SECRET = 'privateDbPassword123';

function fakeTable(name: string): Row {
	return new Proxy(
		{},
		{ get: (_target, property) => (property === '__name' ? name : String(property)) },
	);
}

function inArraySizes(condition: unknown, sizes: number[]): void {
	if (!isSqlNode(condition)) return;
	if (condition.op === 'inArray') sizes.push((condition.args[1] as unknown[]).length);
	for (const part of condition.args) inArraySizes(part, sizes);
}

/** Mock `drizzle-orm` and `@/core/db` for the export queries; returns the shared state. */
export function mockExportDb(): ExportDbState {
	const state: ExportDbState = {
		rowsByTable: {},
		failedTable: null,
		applyConditions: false,
		limits: [],
		inArrayCalls: [],
	};
	const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, fakeTable(name)]));
	const nameOf = (table: unknown) => (table as { __name: ExportTable }).__name;
	mockDrizzle();
	mockDb({
		...tables,
		db: {
			select: () => ({
				from: (table: unknown) => {
					const name = nameOf(table);
					let limit = Number.MAX_SAFE_INTEGER;
					let offset = 0;
					let condition: SqlNode | undefined;
					const rows = Promise.resolve().then(() => {
						if (name === state.failedTable) throw new Error(LEAKED_SECRET);
						const all = state.rowsByTable[name] ?? [];
						const matching = state.applyConditions
							? all.filter((row) => rowMatches(row, condition))
							: all;
						return matching.slice(offset, offset + limit);
					});
					const query = Object.assign(rows, {
						innerJoin: () => query,
						where: (next: SqlNode) => {
							condition = next;
							inArraySizes(next, state.inArrayCalls);
							return query;
						},
						orderBy: () => query,
						limit: (value: number) => {
							state.limits.push(value);
							limit = value;
							return query;
						},
						offset: (value: number) => {
							offset = value;
							return query;
						},
					});
					return query;
				},
			}),
		},
	});
	return state;
}

/** Fresh state for the next request; the mocked modules keep reading the same object. */
export function resetExportDb(state: ExportDbState, next: Partial<ExportDbState> = {}): void {
	state.rowsByTable = next.rowsByTable ?? {};
	state.failedTable = next.failedTable ?? null;
	state.applyConditions = next.applyConditions ?? false;
	state.limits = [];
	state.inArrayCalls = [];
}
