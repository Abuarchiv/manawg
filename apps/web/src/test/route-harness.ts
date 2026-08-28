import { type Table, getTableName } from 'drizzle-orm';
import { type Mock, vi } from 'vitest';

/**
 * Shared test double for `/api/wg/[code]/...` route handlers.
 *
 * Every route test used to hand-roll the same 8-11 `vi.mock()` blocks — roughly
 * 150 lines of preamble per file, ~7,400 lines across the suite. Worse, each
 * copy stubbed `@/core/db` by transcribing the schema into string literals
 * (`expenses: { id: 'expenses.id', ... }`), so renaming a column left every
 * test green while production broke.
 *
 * This harness stubs only what genuinely cannot run in a unit test:
 *
 *   - the database client (no Postgres to talk to)
 *   - `requireMember` (needs the database)
 *   - the outbound side effects: notifications and audit events
 *
 * `checkRateLimit` is deliberately NOT stubbed: without Upstash credentials it
 * fails open, which is what a test wants by default. Suites asserting a 429
 * stub it themselves.
 *
 * Everything else runs for real. In particular the drizzle operators and the
 * schema tables are the real ones, so `db.insert` receives the actual
 * `expenses` table object and a renamed column now fails the test.
 *
 * The `vi.mock()` calls themselves live in `route-setup.ts`, which vitest loads
 * as a setup file for the `route` project.
 */

type AnyFn = (...args: unknown[]) => unknown;

/**
 * The real table name of whatever `db.insert`/`db.update` was handed, for
 * stubs that need to answer differently per table.
 *
 * Use this instead of branching on a stringified schema stub: it reads the
 * name off the actual drizzle table, so a renamed table fails the test instead
 * of quietly passing. Takes `unknown` because mock implementations receive
 * untyped arguments.
 */
export function tableNameOf(table: unknown): string {
	return getTableName(table as Table);
}

/**
 * A readable "table.column" label for a real drizzle column.
 *
 * For the few suites that assert *how* a query is scoped. Pair it with a
 * partial `drizzle-orm` mock so the operator returns something inspectable:
 *
 *   vi.mock('drizzle-orm', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('drizzle-orm')>()),
 *     eq: (col: unknown, value: unknown) => ({ eq: [columnRef(col), value] }),
 *   }));
 *
 * The label is derived from the schema rather than transcribed into the test,
 * so renaming a column changes the assertion instead of silently passing.
 */
export function columnRef(column: unknown): string {
	const col = column as { name?: string; table?: Table };
	if (!col?.name || !col.table) return String(column);
	return `${getTableName(col.table)}.${col.name}`;
}

/**
 * Every value drizzle bound into a condition, in no particular order.
 *
 * A real drizzle condition is a cyclic tree of SQL chunks, so it cannot be
 * JSON.stringify'd and compared. This walks it and collects the parameters,
 * which is what a test asserting "this query is bounded by X" actually cares
 * about.
 */
export function boundParams(condition: unknown): unknown[] {
	const found: unknown[] = [];
	const seen = new WeakSet<object>();
	const visit = (node: unknown): void => {
		if (node === null || typeof node !== 'object') return;
		if (seen.has(node)) return;
		seen.add(node);
		if (node instanceof Date) {
			found.push(node);
			return;
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'value' && (value === null || typeof value !== 'object')) {
				found.push(value);
				continue;
			}
			visit(value);
		}
	};
	visit(condition);
	return found;
}

/** A drizzle query-builder chain that resolves to `rows` at any depth. */
type ChainStub = Promise<unknown[]> & Record<string, AnyFn>;

/**
 * Build a stub for one `db.select()` chain. Every builder method returns the
 * same thenable, so it does not matter whether the route calls
 * `.from().where().limit()` or `.from().where().orderBy().limit()` — awaiting
 * at the end yields `rows`.
 */
export interface ChainOptions {
	/**
	 * Called with the argument the route passed to `.where(...)`, for the rare
	 * test that needs to assert how a query is scoped.
	 */
	onWhere?: (condition: unknown) => void;
}

export function chainOf(rows: unknown[], options: ChainOptions = {}): ChainStub {
	const promise = Promise.resolve(rows) as ChainStub;
	const chain: ChainStub = new Proxy(promise, {
		get(target, prop) {
			// The promise's own methods must stay bound to the real promise —
			// handing them back unbound makes `await` throw "Promise.prototype.then
			// called on incompatible receiver". Everything else is a query-builder
			// step, which returns the chain again so the route can keep calling
			// `.from().where().orderBy().limit()` in any combination.
			if (prop === 'then' || prop === 'catch' || prop === 'finally') {
				return (Reflect.get(target, prop, target) as AnyFn).bind(target);
			}
			if (prop === 'where' && options.onWhere) {
				return (condition: unknown) => {
					options.onWhere?.(condition);
					return chain;
				};
			}
			return () => chain;
		},
	});
	return chain;
}

/**
 * Like {@link chainOf}, but awaiting the chain rejects — for asserting that a
 * route surfaces a database failure instead of swallowing it into an empty
 * result.
 */
export function chainRejecting(error: Error): ChainStub {
	const rejected = Promise.reject(error) as ChainStub;
	// Attached up front so the rejection is never briefly unhandled while the
	// route is still adding .from()/.where() to the chain.
	rejected.catch(() => {});
	const chain: ChainStub = new Proxy(rejected, {
		get(target, prop) {
			if (prop === 'then' || prop === 'catch' || prop === 'finally') {
				return (Reflect.get(target, prop, target) as AnyFn).bind(target);
			}
			return () => chain;
		},
	});
	return chain;
}

/**
 * Per-table `db.query.<table>.findFirst/findMany` stubs, created on first
 * access so a test never has to declare which tables its route touches.
 */
interface QueryHandle {
	findFirst: Mock;
	findMany: Mock;
}

const queryHandles = new Map<string, QueryHandle>();

const queryProxy = new Proxy(
	{},
	{
		get(_target, table: string | symbol) {
			if (typeof table !== 'string') return undefined;
			let handle = queryHandles.get(table);
			if (!handle) {
				handle = { findFirst: vi.fn(), findMany: vi.fn() };
				queryHandles.set(table, handle);
			}
			return handle;
		},
	},
);

interface RouteDb {
	/**
	 * Indexed rather than optional: the proxy materialises a handle for any
	 * table name on first access, so a lookup never actually misses.
	 */
	query: Record<string, QueryHandle> & { wgs: QueryHandle };
	select: Mock;
	insert: Mock;
	update: Mock;
	delete: Mock;
}

export const routeDb: RouteDb = {
	query: queryProxy as Record<string, QueryHandle> & { wgs: QueryHandle },
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
};

export const routeMocks: {
	requireMember: Mock;
	recordAuditEvent: Mock;
	dispatchNotification: Mock;
} = {
	requireMember: vi.fn(),
	recordAuditEvent: vi.fn(),
	dispatchNotification: vi.fn(),
};

/**
 * Queue the results of successive `db.select()` calls, in order. A route that
 * resolves the WG and then checks membership passes two arrays; anything the
 * route selects beyond the queue resolves to `[]`.
 */
export function queueSelects(...stages: ReadonlyArray<unknown[]>): void {
	let call = 0;
	routeDb.select.mockImplementation(() => {
		const rows = stages[call] ?? [];
		call += 1;
		return chainOf(rows);
	});
}

interface FakeWg {
	id: string;
	name: string;
	shareCode: string;
}

const TEST_WG: FakeWg = { id: 'wg-1', name: 'Küche 4', shareCode: 'MTE8PZAT' };

/**
 * The common "caller is a verified member of this WG" setup: resolves the WG
 * lookup, the membership check, and `requireMember` in one call. Extra
 * `selects` are queued after those two stages for whatever the route reads
 * next.
 */
export function authenticateAs(
	memberId: string,
	options: {
		wg?: FakeWg;
		member?: Record<string, unknown>;
		selects?: ReadonlyArray<unknown[]>;
	} = {},
): void {
	const wg = options.wg ?? TEST_WG;
	routeDb.query.wgs.findFirst = vi.fn().mockResolvedValue(wg);
	routeMocks.requireMember.mockResolvedValue({
		ok: true,
		member: { memberId, name: 'Mina', verified: true, ...options.member },
	});
	queueSelects([wg], [{ id: memberId }], ...(options.selects ?? []));
}

/**
 * Reset every handle and restore the permissive defaults. Call from
 * `beforeEach`; a test that wants a 429 or an unauthenticated caller overrides
 * the relevant handle afterwards.
 */
export function resetRouteHarness(): void {
	vi.clearAllMocks();
	queryHandles.clear();
	routeDb.select.mockReset();
	routeDb.insert.mockReset();
	routeDb.update.mockReset();
	routeDb.delete.mockReset();
	routeMocks.recordAuditEvent.mockResolvedValue(undefined);
	routeMocks.dispatchNotification.mockResolvedValue(undefined);
}
