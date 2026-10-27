import assert from 'node:assert/strict';
import test from 'node:test';

const { formatDayMonthYear } = await import('./time');

test('formatDayMonthYear shows the Berlin calendar day', () => {
	assert.equal(formatDayMonthYear('2026-10-06T10:00:00.000Z'), '06.10.2026');
	// 23:30 UTC on the 5th is already 01:30 on the 6th in Berlin (CEST).
	assert.equal(formatDayMonthYear('2026-10-05T23:30:00.000Z'), '06.10.2026');
});

test('formatDayMonthYear falls back for invalid input', () => {
	assert.equal(formatDayMonthYear('not-a-date'), 'Datum unbekannt');
});
