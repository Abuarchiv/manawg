import { numberFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';

export const CENTS_PER_EURO = 100;

/** Legacy rows without a currency are Euro. */
export function normalizeCurrency(currency: string | undefined): string {
	return currency?.trim().toUpperCase() || 'EUR';
}

interface FormatEuroCentsOptions {
	signed?: boolean;
	locale?: Locale;
}

/** Formats a cent amount as a localized currency string (German by default). Sub-cent negatives render as 0, never "-0,00 €"; `signed: true` prefixes positive amounts with "+". */
export function formatEuroCents(
	cents: number,
	currency = 'EUR',
	options?: FormatEuroCentsOptions,
): string {
	const safeCents = Number.isFinite(cents) ? cents : 0;
	// Normalize anything that rounds to zero cents → 0, so Intl.NumberFormat
	// never produces "-0,00 €". Comparing `safeCents === 0` is not enough: it
	// catches -0 but not sub-cent negatives like -0.4, which arise from split
	// remainders and still render with a minus sign.
	const normalized = Math.round(safeCents) === 0 ? 0 : safeCents;
	const formatted = numberFormat(options?.locale ?? 'de', {
		style: 'currency',
		currency,
	}).format(normalized / CENTS_PER_EURO);
	if (options?.signed && normalized > 0) return `+${formatted}`;
	return formatted;
}
