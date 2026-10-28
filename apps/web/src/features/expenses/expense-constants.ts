import { CENTS_PER_EURO } from '@/core/utils/money';
import type { Message } from '@/shared/i18n/message';

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

export const AMOUNT_MIN_EUROS = AMOUNT_MIN_CENTS / CENTS_PER_EURO;
export const AMOUNT_MAX_EUROS = AMOUNT_MAX_CENTS / CENTS_PER_EURO;

// Above the maximum, "over 0 €" would be misleading: the amount is too large, not too small.
export function amountError(euros: number | null, raw = ''): Message {
	if (euros === null && /[.,]\d{3,}\s*(€|EUR)?$/i.test(raw.trim())) {
		return { key: 'expenses-form.validation.amountDecimals' };
	}
	return {
		key:
			euros !== null && euros > AMOUNT_MAX_EUROS
				? 'expenses-form.validation.amountTooLarge'
				: 'expenses-form.validation.amountInvalid',
	};
}

/** Plain German amount error for the fixed-cost form, which shows it as text. */
export function amountErrorMessage(euros: number | null, raw = ''): string {
	if (euros === null && /[.,]\d{3,}\s*(€|EUR)?$/i.test(raw.trim())) {
		return 'Maximal zwei Nachkommastellen.'; // i18n-ignore plain German text for the fixed-cost form
	}
	return euros !== null && euros > AMOUNT_MAX_EUROS
		? 'Der Betrag darf höchstens 1.000.000 € betragen.' // i18n-ignore plain German text for the fixed-cost form
		: 'Gib einen Betrag über 0 € ein, z. B. 12,50.'; // i18n-ignore plain German text for the fixed-cost form
}

/** Picker values in order; the German `label` is plain text for the fixed-cost form. */
export const RECURRING_INTERVAL_OPTIONS = [
	{ value: 1, label: '1 Monat' }, // i18n-ignore plain German text for the fixed-cost form
	{ value: 2, label: '2 Monate' }, // i18n-ignore plain German text for the fixed-cost form
	{ value: 3, label: 'Quartal' }, // i18n-ignore plain German text for the fixed-cost form
	{ value: 6, label: '6 Monate' }, // i18n-ignore plain German text for the fixed-cost form
	{ value: 12, label: 'Jahr' }, // i18n-ignore plain German text for the fixed-cost form
] as const;

/** How often a template books ("monatlich", "alle 4 Monate"), as data. */
export function recurringIntervalLabel(intervalMonths: number): Message {
	const months = Math.max(1, Math.floor(intervalMonths));
	if (months === 1) return { key: 'expenses-form.intervals.monthly' };
	if (months === 3) return { key: 'expenses-form.intervals.quarterly' };
	if (months === 6) return { key: 'expenses-form.intervals.halfYearly' };
	if (months === 12) return { key: 'expenses-form.intervals.yearly' };
	return { key: 'expenses-form.intervals.everyMonths', values: { count: months } };
}

/** Picker text of one interval option, as data. */
export function recurringIntervalOption(intervalMonths: number): Message {
	if (intervalMonths === 3) return { key: 'expenses-form.intervals.optionQuarter' };
	if (intervalMonths === 12) return { key: 'expenses-form.intervals.optionYear' };
	return { key: 'expenses-form.intervals.optionMonths', values: { count: intervalMonths } };
}
