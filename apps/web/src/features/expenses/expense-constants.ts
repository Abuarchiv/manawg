/**
 * Money bounds for expense amounts, in cents.
 *
 * Shared by the zod schema (API routes) and the CSV import sanity check
 * (import-parsers.ts) so they can never drift apart. Must stay consistent
 * with the DB CHECK constraint `expenses.amount_cents > 0`.
 */
export const AMOUNT_MIN_CENTS = 1;
export const AMOUNT_MAX_CENTS = 100_000_000;
