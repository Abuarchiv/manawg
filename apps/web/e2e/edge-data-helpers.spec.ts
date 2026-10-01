import { expect, test } from '@playwright/test';
import { initials } from '../src/components/wg/MemberAvatar';
import { groupActivityItemsByDay } from '../src/core/reads/activity';
import {
	formatCompactRelativeTime,
	formatRelativeTime,
	formatShortDate,
	formatWeekLabel,
} from '../src/core/utils/time';
import { previewBody } from '../src/features/chat/chat-pure';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';

// Pure edge-case regressions (dates around DST/midnight, device zones, emoji, long digits).
const item = (timestamp: string) => ({
	id: timestamp,
	kind: 'chore' as const,
	timestamp,
	memberName: 'A',
	text: 't',
	completed: true,
});

function withTz(tz: string, run: () => void): void {
	const previous = process.env.TZ;
	process.env.TZ = tz;
	try {
		run();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, 'TZ');
		else process.env.TZ = previous;
	}
}

test('"Gestern" is the previous Berlin day on the day after spring-forward', () => {
	// 30.03.2026 00:30 CEST; 29.03. had only 23h, so now-24h lands on 28.03.
	const now = Date.parse('2026-03-29T22:30:00Z');
	const groups = groupActivityItemsByDay([item('2026-03-29T10:00:00Z')], now);
	expect(groups[0]?.label).toBe('Gestern');
});

test('day labels do not shift for devices ahead of Berlin', () => {
	withTz('Pacific/Kiritimati', () => {
		const groups = groupActivityItemsByDay(
			[item('2026-09-20T10:00:00Z')],
			Date.parse('2026-10-01T10:00:00Z'),
		);
		expect(groups[0]?.label).toMatch(/20\.09\./);
	});
});

test('Berlin short dates ignore the device zone', () => {
	withTz('America/New_York', () => {
		// Berlin 02.10. 00:30 is still 01.10. in New York.
		expect(formatShortDate('2026-10-01T22:30:00Z', 'Europe/Berlin')).toBe('02.10.');
	});
});

test('relative labels count calendar days, not 24h blocks', () => {
	const now = new Date(2026, 9, 1, 8, 0).getTime();
	const in47h = new Date(now + 47 * 3_600_000).toISOString();
	const ago47h = new Date(now - 47 * 3_600_000).toISOString();
	expect(formatRelativeTime(in47h, now)).toBe('in 2 Tagen');
	expect(formatRelativeTime(ago47h, now)).toBe('vor 2 Tagen');
	expect(formatCompactRelativeTime(in47h, now)).toBe('in 2 T.');
	expect(formatCompactRelativeTime(ago47h, now)).toBe('2 T.');
});

test('week labels one year apart stay unique', () => {
	const now = new Date(2026, 9, 1);
	const a = formatWeekLabel(new Date(2025, 9, 6), now);
	const b = formatWeekLabel(new Date(2024, 9, 7), now);
	expect(a).toBe('Woche ab 06.10.2025');
	expect(a).not.toBe(b);
});

test('emoji are never cut in half', () => {
	expect(initials('😀 Max')).toBe('😀M');
	expect(initials('😀😀😀')).toBe('😀😀');
	expect(previewBody('😀'.repeat(10), 5)).toBe('😀😀😀😀…');
});

test('an overlong digit run is a name, not a quantity', () => {
	const name = `${'1'.repeat(45)} Milch`;
	expect(parseShoppingInput(name)).toEqual({ name, quantity: null });
});
