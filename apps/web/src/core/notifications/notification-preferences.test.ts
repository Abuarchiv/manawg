import { describe, expect, it } from 'vitest';
import { isQuietHoursActive, parseQuietHour } from './notification-preferences';

describe('parseQuietHour', () => {
	it('parses valid select values and treats empty as disabled', () => {
		expect(parseQuietHour('')).toBeNull();
		expect(parseQuietHour('0')).toBe(0);
		expect(parseQuietHour('23')).toBe(23);
	});

	it('rejects invalid or ambiguous hour values', () => {
		expect(parseQuietHour('24')).toBeNull();
		expect(parseQuietHour('-1')).toBeNull();
		expect(parseQuietHour('7.5')).toBeNull();
		expect(parseQuietHour('abc')).toBeNull();
	});
});

describe('isQuietHoursActive', () => {
	it('suppresses notifications inside an overnight quiet window', () => {
		expect(isQuietHoursActive(23, 22, 7)).toBe(true);
		expect(isQuietHoursActive(6, 22, 7)).toBe(true);
		expect(isQuietHoursActive(12, 22, 7)).toBe(false);
	});

	it('supports same-day quiet windows', () => {
		expect(isQuietHoursActive(13, 12, 14)).toBe(true);
		expect(isQuietHoursActive(15, 12, 14)).toBe(false);
	});
});
