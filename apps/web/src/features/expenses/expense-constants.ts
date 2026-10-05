/**
 * Money bounds for expense amounts, in cents.
 *
 * Shared by the zod schema (API routes) and the CSV import sanity check
 * (import-parsers.ts) so they can never drift apart. Must stay consistent
 * with the DB CHECK constraint `expenses.amount_cents > 0`.
 */
export const AMOUNT_MIN_CENTS = 1;
export const AMOUNT_MAX_CENTS = 100_000_000;

/** Longest expense or template description the API accepts. */
export const DESCRIPTION_MAX_LENGTH = 200;
/** Most debtor shares one expense or template may have. */
export const MAX_SPLITS = 50;
/** Longest billing interval of a recurring template. */
export const RECURRING_INTERVAL_MAX_MONTHS = 24;
