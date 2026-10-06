// Edge cases of shared display helpers: dates around DST and midnight, device time zones, emoji
// and long digit runs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { initials } from '../src/components/wg/member-initials';
import { groupActivityItemsByDay } from '../src/composition/activity-views';
import { formatRelativeTime, formatShortDate, formatWeekLabel } from '../src/core/utils/time';
import { previewBody } from '../src/features/chat/chat-pure';
import { parseShoppingInput } from '../src/features/shopping/parse-shopping-input';

describe('edge data helpers', () => {
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
		assert.equal(groups[0]?.label, 'Gestern');
	});

	test('day labels do not shift for devices ahead of Berlin', () => {
		withTz('Pacific/Kiritimati', () => {
			const groups = groupActivityItemsByDay(
				[item('2026-09-20T10:00:00Z')],
				Date.parse('2026-10-01T10:00:00Z'),
			);
			assert.match(groups[0]?.label ?? '', /20\.09\./);
		});
	});

	test('Berlin short dates ignore the device zone', () => {
		withTz('America/New_York', () => {
			// Berlin 02.10. 00:30 is still 01.10. in New York.
			assert.equal(formatShortDate('2026-10-01T22:30:00Z', 'Europe/Berlin'), '02.10.');
		});
	});

	test('relative labels count calendar days, not 24h blocks', () => {
		const now = new Date(2026, 9, 1, 8, 0).getTime();
		const in47h = new Date(now + 47 * 3_600_000).toISOString();
		const ago47h = new Date(now - 47 * 3_600_000).toISOString();
		assert.equal(formatRelativeTime(in47h, now), 'in 2 Tagen');
		assert.equal(formatRelativeTime(ago47h, now), 'vor 2 Tagen');
	});

	test('week labels one year apart stay unique', () => {
		const now = new Date(2026, 9, 1);
		const a = formatWeekLabel(new Date(2025, 9, 6), now);
		const b = formatWeekLabel(new Date(2024, 9, 7), now);
		assert.equal(a, 'Woche ab 06.10.2025');
		assert.notEqual(a, b);
	});

	test('emoji are never cut in half', () => {
		assert.equal(initials('😀 Max'), '😀M');
		assert.equal(initials('😀😀😀'), '😀😀');
		assert.equal(previewBody('😀'.repeat(10), 5), '😀😀😀😀…');
	});

	test('an overlong digit run is a name, not a quantity', () => {
		const name = `${'1'.repeat(45)} Milch`;
		assert.deepEqual(parseShoppingInput(name), { name, quantity: null });
	});
});
