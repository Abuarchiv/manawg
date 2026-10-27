// Pure helpers for Postgres error codes: no pg or drizzle import, so client-safe feature files may use them.

const UNIQUE_VIOLATION = '23505';

/** The Postgres unique violation (23505) in err or its `cause` chain (cycle-safe); constraint is `constraint` ?? `constraint_name` ?? null. */
export function findUniqueViolation(err: unknown): { constraint: string | null } | null {
	const seen = new Set<object>();
	let current: unknown = err;
	while (current && typeof current === 'object' && !seen.has(current)) {
		seen.add(current);
		const pg = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
		if (pg.code === UNIQUE_VIOLATION) {
			const constraint = pg.constraint ?? pg.constraint_name;
			return { constraint: typeof constraint === 'string' ? constraint : null };
		}
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/** True for a unique violation; with `constraint`, only for that one. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
	const violation = findUniqueViolation(err);
	return violation !== null && (constraint === undefined || violation.constraint === constraint);
}
