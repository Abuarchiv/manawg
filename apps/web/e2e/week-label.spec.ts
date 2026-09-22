import { expect, test } from '@playwright/test';
import { formatWeekLabel, startOfWeek } from '../src/core/utils/time';

test('labels expense weeks relative to now', () => {
	const now = new Date(2026, 8, 24, 10); // Mittwoch
	expect(startOfWeek(now)).toEqual(new Date(2026, 8, 21));
	expect(startOfWeek(new Date(2026, 8, 27, 23))).toEqual(new Date(2026, 8, 21)); // Sonntag
	expect(formatWeekLabel(startOfWeek(now), now)).toBe('Diese Woche');
	expect(formatWeekLabel(new Date(2026, 8, 14), now)).toBe('Letzte Woche');
	expect(formatWeekLabel(new Date(2026, 8, 7), now)).toBe('Woche ab 07.09.');
});
