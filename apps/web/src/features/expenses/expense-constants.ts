import { CENTS_PER_EURO } from '@/core/utils/money';
import { LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';

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

/** Refresh period of the expense, fixed-cost and reminder pages while the tab is visible. */
export const PAGE_REFRESH_MS = LIST_REFRESH_INTERVAL_MS;

export const AMOUNT_MIN_EUROS = AMOUNT_MIN_CENTS / CENTS_PER_EURO;
export const AMOUNT_MAX_EUROS = AMOUNT_MAX_CENTS / CENTS_PER_EURO;
export const DESCRIPTION_MAX = DESCRIPTION_MAX_LENGTH;

// Above the maximum, "over 0 €" would be misleading: the amount is too large, not too small.
export function amountErrorMessage(euros: number | null, raw = ''): string {
	if (euros === null && /[.,]\d{3,}\s*(€|EUR)?$/i.test(raw.trim())) {
		return 'Maximal zwei Nachkommastellen.';
	}
	return euros !== null && euros > AMOUNT_MAX_EUROS
		? 'Der Betrag darf höchstens 1.000.000 € betragen.'
		: 'Gib einen Betrag über 0 € ein, z. B. 12,50.';
}

export const RECURRING_INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' },
	{ value: 2, label: '2 Monate' },
	{ value: 3, label: 'Quartal' },
	{ value: 6, label: '6 Monate' },
	{ value: 12, label: 'Jahr' },
] as const;
