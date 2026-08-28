export const CENTS_PER_EURO = 100;

interface FormatEuroCentsOptions {
	signed?: boolean;
}

/**
 * Renders a cent amount as a localized de-DE currency string.
 *
 * - Uses `Intl.NumberFormat('de-DE', { style: 'currency', currency })`.
 * - Normalizes `-0` (and tiny sub-cent negatives) to `0` so we never render `-0,00 €`.
 * - With `{ signed: true }`, prefixes positive amounts with `+`.
 *
 * Centralizing here prevents drift like `(cents / 100).toFixed(2) + ' €'`
 * which would render `0,5 € → "0.50 €"` instead of `"0,50 €"`.
 */
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
	const formatted = new Intl.NumberFormat('de-DE', {
		style: 'currency',
		currency,
	}).format(normalized / CENTS_PER_EURO);
	if (options?.signed && normalized > 0) return `+${formatted}`;
	return formatted;
}
