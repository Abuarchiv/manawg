import { describe, expect, it } from 'vitest';
import {
	formatCompactRelativeTime,
	formatRelativeTime,
	formatShortDate,
	formatShortDateRange,
	formatTimeFull,
	parseTimestamp,
} from './time';

describe('time formatting', () => {
	it('formats recent timestamps relatively', () => {
		expect(
			formatRelativeTime(
				'2026-05-19T10:55:00.000Z',
				new Date('2026-05-19T11:00:00.000Z').getTime(),
			),
		).toBe('vor 5 Min');
	});

	it('falls back gracefully for invalid timestamps', () => {
		expect(formatRelativeTime('not-a-date')).toBe('Zeit unbekannt');
		expect(formatTimeFull('not-a-date')).toBe('Zeit unbekannt');
		expect(formatCompactRelativeTime('not-a-date')).toBe('unbekannt');
	});

	it('formats compact timestamps for dense dashboard lists', () => {
		const now = new Date('2026-05-19T11:00:00.000Z').getTime();

		expect(formatCompactRelativeTime('2026-05-19T10:55:00.000Z', now)).toBe('5 Min.');
		expect(formatCompactRelativeTime('2026-05-19T09:00:00.000Z', now)).toBe('2 Std.');
	});

	it('formats short dates and keeps invalid values readable', () => {
		expect(formatShortDate('2026-05-20T12:00:00.000Z')).toBe('20.05.');
		expect(formatShortDate('broken')).toBe('Datum unbekannt');
		expect(formatShortDateRange('2026-05-20T12:00:00.000Z', 'broken')).toBe(
			'20.05. bis Datum unbekannt',
		);
	});

	it('parses valid timestamps and rejects invalid dates', () => {
		expect(parseTimestamp('2026-05-20T12:00:00.000Z')).toBe(
			new Date('2026-05-20T12:00:00.000Z').getTime(),
		);
		expect(parseTimestamp(new Date('2026-05-20T12:00:00.000Z'))).toBe(
			new Date('2026-05-20T12:00:00.000Z').getTime(),
		);
		expect(parseTimestamp('broken')).toBeNull();
	});
});
