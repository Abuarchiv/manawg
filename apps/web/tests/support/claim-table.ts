import { mock } from 'node:test';
import { type SqlNode, rowMatches } from './drizzle-mock';

/**
 * An in-memory `idempotency_responses` table for tests that run the real claim protocol
 * (`claimed-response`, `idempotent-write`) on a fake database. Columns are row property names,
 * so the conditions of {@link ./drizzle-mock.ts} evaluate directly against the rows.
 */
export const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
} as const;

export const CLAIM_LEASE_MS = 15 * 60_000;
const PLACEHOLDER_JSON = '{"_claimed":true}';

export interface ClaimRow {
	scope: string;
	key: string;
	responseBody: unknown;
	expiresAt: Date;
}

const isPlaceholder = (body: unknown) => JSON.stringify(body) === PLACEHOLDER_JSON;

/** The raw fragments the claim helpers use: placeholder jsonb equality and lease expiry. */
function claimSql(row: Record<string, unknown>, fragment: SqlNode): boolean {
	const text = fragment.text ?? '';
	if (text.includes(`= '${PLACEHOLDER_JSON}'::jsonb`)) return isPlaceholder(row.responseBody);
	if (text.includes('> now()')) return (row.expiresAt as Date) > new Date();
	if (text.includes('<= now()')) return (row.expiresAt as Date) <= new Date();
	throw new Error(`unsupported claim sql: ${text}`);
}

export class ClaimTable {
	rows: ClaimRow[] = [];

	/** Row locks taken by `select ... for (...)`, in order. */
	locks: string[] = [];

	/** Rows whose jsonb body round-trips through JSON, as Postgres stores it. */
	jsonb = true;

	matching(condition: unknown): ClaimRow[] {
		return this.rows.filter((row) =>
			rowMatches(row as unknown as Record<string, unknown>, condition, claimSql),
		);
	}

	find(scope: string, key: string): ClaimRow | undefined {
		return this.rows.find((row) => row.scope === scope && row.key === key);
	}

	/** The only row, for tests that use a single key. */
	get slot(): ClaimRow | undefined {
		return this.rows[0];
	}

	put(row: ClaimRow): void {
		this.rows = [...this.rows.filter((r) => r.scope !== row.scope || r.key !== row.key), row];
	}

	snapshot(): ClaimRow[] {
		return this.rows.map((row) => ({ ...row }));
	}

	restore(rows: ClaimRow[]): void {
		this.rows = rows;
	}

	/** `claimResponseSlot`: insert a placeholder lease unless a live row holds the key. */
	claim(scope: string, key: string, leaseMs = CLAIM_LEASE_MS): boolean {
		const existing = this.find(scope, key);
		if (existing && existing.expiresAt > new Date()) return false;
		this.put({
			scope,
			key,
			responseBody: { _claimed: true },
			expiresAt: new Date(Date.now() + leaseMs),
		});
		return true;
	}

	/** `getCachedResponse`: the live stored response, never a placeholder. */
	cached(scope: string, key: string): unknown {
		const row = this.find(scope, key);
		if (!row || !(row.expiresAt > new Date()) || isPlaceholder(row.responseBody)) return null;
		const body = row.responseBody as { _replayUnavailable?: unknown } | null;
		if (body && typeof body === 'object' && body._replayUnavailable === true) {
			throw new Error('idempotency_cache_read_failed');
		}
		return row.responseBody;
	}

	/** `select(...).from(idempotencyResponses).where(...).limit(1).for('update')`. */
	select(columns: Record<string, unknown>) {
		return {
			from: () => ({
				where: (condition: unknown) => {
					const read = async () =>
						this.matching(condition).map((row) =>
							Object.fromEntries(
								Object.entries(columns).map(([alias, column]) => [
									alias,
									(row as unknown as Record<string, unknown>)[column as string],
								]),
							),
						);
					return {
						limit: () => ({
							for: async (lock: string) => {
								this.locks.push(lock);
								return read();
							},
						}),
					};
				},
			}),
		};
	}

	/** `update(idempotencyResponses).set(values).where(...).returning()`. */
	update() {
		return {
			set: (values: Partial<ClaimRow>) => ({
				where: (condition: unknown) => ({
					returning: async () => {
						const updated = this.matching(condition);
						for (const row of updated) {
							if (values.responseBody !== undefined) {
								row.responseBody = this.jsonb
									? JSON.parse(JSON.stringify(values.responseBody))
									: values.responseBody;
							}
							if (values.expiresAt !== undefined) row.expiresAt = values.expiresAt;
						}
						return updated.map((row) => ({ scope: row.scope, key: row.key }));
					},
				}),
			}),
		};
	}

	/** `delete(idempotencyResponses).where(...).returning()`. */
	delete() {
		return {
			where: (condition: unknown) => ({
				returning: async () => {
					const removed = this.matching(condition);
					this.rows = this.rows.filter((row) => !removed.includes(row));
					return removed.map((row) => ({ scope: row.scope, key: row.key }));
				},
			}),
		};
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `readIdempotencyKey`: a UUID header, trimmed and lower-cased, or null. */
export function readIdempotencyKey(req: Request): string | null {
	const raw = req.headers.get('idempotency-key')?.trim();
	return raw && UUID.test(raw) ? raw.toLowerCase() : null;
}

interface WarningTarget {
	match: ReadonlyArray<{ path: readonly string[]; equals: string }>;
	warningPath: readonly string[];
	replaces: ReadonlyArray<string | null>;
}

function at(body: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(value, segment) =>
			value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined,
		body,
	);
}

/** `setReplayWarning` on the table: only the live response of the expected row changes. */
function setTableReplayWarning(
	table: ClaimTable,
	scope: string,
	key: string,
	target: WarningTarget,
	warning: string | null,
): boolean {
	const row = table.find(scope, key);
	if (!row || !(row.expiresAt > new Date())) return false;
	if (!target.match.every(({ path, equals }) => String(at(row.responseBody, path)) === equals)) {
		return false;
	}
	const current = at(row.responseBody, target.warningPath) ?? null;
	if (!target.replaces.includes(current as string | null)) return false;
	const parent = at(row.responseBody, target.warningPath.slice(0, -1));
	if (!parent || typeof parent !== 'object') return false;
	(parent as Record<string, unknown>)[target.warningPath.at(-1) as string] = warning;
	return true;
}

/**
 * Mock `@/core/idempotency-store` on top of a {@link ClaimTable}; `overrides` replace single
 * functions (e.g. a failing claim).
 */
export function mockIdempotencyStore(
	table: ClaimTable,
	overrides: Record<string, unknown> = {},
): void {
	mock.module('@/core/idempotency-store', {
		namedExports: {
			readIdempotencyKey,
			claimResponseSlot: async (scope: string, key: string) => table.claim(scope, key),
			getCachedResponse: async (scope: string, key: string) => table.cached(scope, key),
			setReplayWarning: async (
				scope: string,
				key: string,
				target: WarningTarget,
				warning: string | null,
			) => setTableReplayWarning(table, scope, key, target, warning),
			purgeExpiredIdempotencyResponses: async () => 0,
			...overrides,
		},
	});
}
