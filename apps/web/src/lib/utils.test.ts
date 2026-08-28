import { describe, expect, it } from 'vitest';
import { formatDate, formatRelativeDate } from './utils';

describe('date utils', () => {
	it('formats dates and keeps invalid values readable', () => {
		expect(formatDate('2026-05-19T12:00:00.000Z')).toContain('2026');
		expect(formatDate('broken')).toBe('Datum unbekannt');
	});

	it('does not throw for invalid relative dates', () => {
		expect(formatRelativeDate('broken')).toBe('Datum unbekannt');
	});
});
