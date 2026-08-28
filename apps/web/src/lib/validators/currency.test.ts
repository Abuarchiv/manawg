import { describe, expect, it } from 'vitest';
import { SUPPORTED_CURRENCIES, currencySchema } from './currency';

describe('currencySchema', () => {
	it('accepts a valid supported currency (EUR)', () => {
		const result = currencySchema.safeParse('EUR');
		expect(result.success).toBe(true);
	});

	it('rejects an arbitrary 3-letter code (ABC)', () => {
		const result = currencySchema.safeParse('ABC');
		expect(result.success).toBe(false);
	});

	it('exposes the full set of supported currencies', () => {
		expect(SUPPORTED_CURRENCIES).toEqual(['EUR', 'CHF', 'USD', 'GBP']);
	});
});
