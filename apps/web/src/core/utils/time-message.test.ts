import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const {
	MS_PER_DAY,
	MS_PER_HOUR,
	formatDayMonthYear,
	formatRelativeTime,
	formatShortDate,
	formatShortDateRange,
	formatTimeFull,
	formatWeekLabel,
	relativeTimeMessage,
	startOfWeek,
	weekLabelMessage,
} = await import('./time');

const NOW = new Date('2026-10-14T09:30:00.000Z').getTime();
const OFFSETS_MS = [
	0,
	30_000,
	-30_000,
	-59_000,
	-60_000,
	60_000,
	5 * 60_000,
	59 * 60_000,
	-5 * 60_000,
	-59 * 60_000,
	MS_PER_HOUR,
	3 * MS_PER_HOUR,
	23 * MS_PER_HOUR,
	-MS_PER_HOUR,
	-3 * MS_PER_HOUR,
	-23 * MS_PER_HOUR,
	MS_PER_DAY,
	2 * MS_PER_DAY,
	3 * MS_PER_DAY,
	6 * MS_PER_DAY,
	7 * MS_PER_DAY,
	40 * MS_PER_DAY,
	-MS_PER_DAY,
	-2 * MS_PER_DAY,
	-3 * MS_PER_DAY,
	-6 * MS_PER_DAY,
	-7 * MS_PER_DAY,
	-47 * MS_PER_HOUR,
	47 * MS_PER_HOUR,
];

test('relativeTimeMessage renders the same German as formatRelativeTime', () => {
	const t = serverRootT('de');
	for (const offset of OFFSETS_MS) {
		const iso = new Date(NOW - offset).toISOString();
		assert.equal(
			renderMessage(t, relativeTimeMessage(iso, NOW)),
			formatRelativeTime(iso, NOW),
			`offset ${offset}`,
		);
	}
	assert.equal(renderMessage(t, relativeTimeMessage('nope', NOW)), formatRelativeTime('nope', NOW));
});

test('relativeTimeMessage renders English words', () => {
	const t = serverRootT('en');
	const at = (offset: number) =>
		renderMessage(t, relativeTimeMessage(new Date(NOW - offset).toISOString(), NOW, 'en'));
	assert.equal(at(10_000), 'just now');
	assert.equal(at(5 * 60_000), '5 min ago');
	assert.equal(at(3 * MS_PER_HOUR), '3 h ago');
	assert.equal(at(-5 * 60_000), 'in 5 min');
	assert.equal(at(-3 * MS_PER_HOUR), 'in 3 h');
	assert.equal(renderMessage(t, relativeTimeMessage('nope', NOW, 'en')), 'Time unknown');
	assert.match(at(40 * MS_PER_DAY), /^\d\d\/\d\d, \d\d:\d\d$/);
});

test('relativeTimeMessage keeps counts as numbers', () => {
	assert.deepEqual(relativeTimeMessage(new Date(NOW - 5 * 60_000).toISOString(), NOW), {
		key: 'common.time.minutesAgo',
		values: { count: 5 },
	});
});

test('weekLabelMessage renders the same German as formatWeekLabel', () => {
	const t = serverRootT('de');
	const now = new Date(2026, 9, 14, 12);
	for (const weeksAgo of [0, 1, 2, 5, 30, 52, 53, -1, -3]) {
		const weekStart = startOfWeek(new Date(now.getTime() - weeksAgo * 7 * MS_PER_DAY));
		assert.equal(
			renderMessage(t, weekLabelMessage(weekStart, now)),
			formatWeekLabel(weekStart, now),
			`weeks ago ${weeksAgo}`,
		);
	}
});

test('weekLabelMessage renders English words and dates', () => {
	const t = serverRootT('en');
	const now = new Date(2026, 9, 14, 12);
	const render = (weeksAgo: number) =>
		renderMessage(
			t,
			weekLabelMessage(startOfWeek(new Date(now.getTime() - weeksAgo * 7 * MS_PER_DAY)), now, 'en'),
		);
	assert.equal(render(0), 'This week');
	assert.equal(render(1), 'Last week');
	assert.equal(render(5), 'Week of 07/09');
	assert.equal(render(52), 'Week of 13/10/2025');
});

test('date formatters take a locale and default to German', () => {
	const iso = '2026-10-06T10:00:00.000Z';
	assert.equal(formatShortDate(iso, 'Europe/Berlin'), '06.10.');
	assert.equal(formatShortDate(iso, 'Europe/Berlin', 'en'), '06/10');
	assert.equal(formatDayMonthYear(iso), '06.10.2026');
	assert.equal(formatDayMonthYear(iso, 'en'), '06/10/2026');
	assert.equal(formatTimeFull('2026-10-06T10:05:00.000Z', 'de').slice(0, 10), '06.10.2026');
	assert.match(formatTimeFull('2026-10-06T10:05:00.000Z', 'en'), /^06\/10\/2026, \d\d:\d\d$/);
	assert.equal(formatShortDateRange(iso, '2026-10-09T10:00:00.000Z'), '06.10. bis 09.10.');
	assert.equal(formatShortDateRange(iso, '2026-10-09T10:00:00.000Z', 'en'), '06/10 to 09/10');
	assert.equal(formatDayMonthYear('nope', 'en'), 'Date unknown');
	assert.equal(formatTimeFull('nope', 'en'), 'Time unknown');
});
