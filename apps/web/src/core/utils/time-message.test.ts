import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const {
	MS_PER_DAY,
	MS_PER_HOUR,
	formatDayMonthYear,
	formatShortDate,
	formatShortDateRange,
	formatTimeFull,
	relativeTimeMessage,
	startOfWeek,
	weekLabelMessage,
} = await import('./time');

const NOW = new Date('2026-10-14T09:30:00.000Z').getTime();
test('relativeTimeMessage renders German words', () => {
	const t = serverRootT('de');
	const at = (offset: number) =>
		renderMessage(t, relativeTimeMessage(new Date(NOW - offset).toISOString(), NOW));
	assert.equal(at(10_000), 'gerade eben');
	assert.equal(at(5 * 60_000), 'vor 5 Min');
	assert.equal(at(3 * MS_PER_HOUR), 'vor 3 Std');
	assert.equal(at(MS_PER_DAY), 'gestern');
	assert.equal(at(3 * MS_PER_DAY), 'vor 3 Tagen');
	assert.equal(at(-5 * 60_000), 'in 5 Min');
	assert.equal(at(-3 * MS_PER_HOUR), 'in 3 Std');
	assert.equal(at(-MS_PER_DAY), 'morgen');
	assert.equal(at(-3 * MS_PER_DAY), 'in 3 Tagen');
	assert.match(at(40 * MS_PER_DAY), /^\d\d\.\d\d\., \d\d:\d\d$/);
	assert.equal(renderMessage(t, relativeTimeMessage('nope', NOW)), 'Zeit unbekannt');
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
	assert.match(at(40 * MS_PER_DAY), /^\d{1,2} \p{L}{3,4}, \d\d:\d\d$/u);
});

test('relativeTimeMessage keeps counts as numbers', () => {
	assert.deepEqual(relativeTimeMessage(new Date(NOW - 5 * 60_000).toISOString(), NOW), {
		key: 'common.time.minutesAgo',
		values: { count: 5 },
	});
});

test('weekLabelMessage renders German words and dates', () => {
	const t = serverRootT('de');
	const now = new Date(2026, 9, 14, 12);
	const render = (weeksAgo: number) =>
		renderMessage(
			t,
			weekLabelMessage(startOfWeek(new Date(now.getTime() - weeksAgo * 7 * MS_PER_DAY)), now),
		);
	assert.equal(render(0), 'Diese Woche');
	assert.equal(render(1), 'Letzte Woche');
	assert.equal(render(5), 'Woche ab 07.09.');
	assert.equal(render(52), 'Woche ab 13.10.2025');
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
	assert.equal(render(5), 'Week of 7 Sept');
	assert.equal(render(52), 'Week of 13 Oct 2025');
});

test('date formatters take a locale and default to German', () => {
	const iso = '2026-10-06T10:00:00.000Z';
	assert.equal(formatShortDate(iso, 'Europe/Berlin'), '06.10.');
	assert.equal(formatShortDate(iso, 'Europe/Berlin', 'en'), '6 Oct');
	assert.equal(formatDayMonthYear(iso), '06.10.2026');
	assert.equal(formatDayMonthYear(iso, 'en'), '6 Oct 2026');
	const localNoon = new Date(2026, 9, 6, 12, 5).toISOString();
	assert.equal(formatTimeFull(localNoon, 'de').slice(0, 10), '06.10.2026');
	assert.match(formatTimeFull(localNoon, 'en'), /^6 Oct 2026, \d\d:\d\d$/);
	assert.equal(formatShortDateRange(iso, '2026-10-09T10:00:00.000Z'), '06.10. bis 09.10.');
	assert.equal(formatShortDateRange(iso, '2026-10-09T10:00:00.000Z', 'en'), '6 Oct to 9 Oct');
	assert.equal(formatShortDateRange(iso, iso), '06.10.');
	assert.equal(formatShortDateRange(iso, iso, 'en'), '6 Oct');
	assert.equal(formatShortDateRange(iso, '2027-10-06T10:00:00.000Z'), '06.10. bis 06.10.');
	assert.equal(formatDayMonthYear('nope', 'en'), 'Date unknown');
	assert.equal(formatTimeFull('nope', 'en'), 'Time unknown');
});
