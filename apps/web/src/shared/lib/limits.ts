/**
 * Input limits shared by forms and API validation, so the browser and the
 * server reject exactly the same values. Dependency-free on purpose: client
 * components import it, and must not pull in Drizzle via `core/db/schema`.
 *
 * `MEMBER_NAME_MAX_LENGTH` mirrors `LIMITS.NAME_MAX` in `core/db/schema.ts`;
 * `tests/shared-limits.test.ts` keeps the two equal.
 */
export const WG_NAME_MAX_LENGTH = 100;
export const MEMBER_NAME_MAX_LENGTH = 80;
/** Active members a WG can hold; moved-out members do not count. */
export const MAX_MEMBERS_PER_WG = 20;

// Wide enough for yearly birthdays and long-range planning; anything outside is
// a typo (year 0026, 20266) that would otherwise be stored and expanded.
const YEAR_MIN = 1900;
const YEAR_MAX = 2200;

export function isYearInRange(date: Date): boolean {
	const year = date.getUTCFullYear();
	return !Number.isNaN(year) && year >= YEAR_MIN && year <= YEAR_MAX;
}
