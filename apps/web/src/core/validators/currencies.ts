/**
 * Supported ISO 4217 currency codes for expense amounts.
 *
 * Kept narrow on purpose — `Intl.NumberFormat` throws on unknown codes, so
 * accepting arbitrary 3-letter strings (e.g. "ABC") would surface as a runtime
 * crash on the client. Existing DB rows with other currencies are not affected
 * (no schema migration).
 *
 * Free of zod so client code can check a currency without shipping the schema library.
 */
export const SUPPORTED_CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'] as const;

type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: unknown): value is Currency {
	return (SUPPORTED_CURRENCIES as readonly unknown[]).includes(value);
}
