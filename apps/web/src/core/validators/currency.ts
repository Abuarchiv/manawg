import { z } from 'zod';

/**
 * Supported ISO 4217 currency codes for expense amounts.
 *
 * Kept narrow on purpose — `Intl.NumberFormat` throws on unknown codes, so
 * accepting arbitrary 3-letter strings (e.g. "ABC") would surface as a runtime
 * crash on the client. Existing DB rows with other currencies are not affected
 * (no schema migration).
 */
const SUPPORTED_CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP'] as const;

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);
