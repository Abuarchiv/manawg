import { describe, expect, it } from 'vitest';
import { formatEuroInput, parseEuroAmount } from './amount';

describe('amount helpers', () => {
	it('parses comma and dot decimal euro amounts', () => {
		expect(parseEuroAmount('12,34')).toBe(12.34);
		expect(parseEuroAmount('12.34')).toBe(12.34);
		expect(parseEuroAmount('12,')).toBe(12);
	});

	it('rejects partial, ambiguous, and over-precise values', () => {
		expect(parseEuroAmount('')).toBeNull();
		expect(parseEuroAmount(',')).toBeNull();
		expect(parseEuroAmount('12abc')).toBeNull();
		expect(parseEuroAmount('1.234,56')).toBeNull();
		expect(parseEuroAmount('12,345')).toBeNull();
	});

	it('formats euro input values with a comma separator', () => {
		expect(formatEuroInput(12)).toBe('12,00');
		expect(formatEuroInput(12.3)).toBe('12,30');
	});
});
