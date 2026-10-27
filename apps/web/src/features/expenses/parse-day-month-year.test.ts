import assert from 'node:assert/strict';
import test from 'node:test';

const { parseDayMonthYear, parseDateIso } = await import('./import-csv-helpers');
const { parseOcrText } = await import('./ocr');

test('parseDayMonthYear expands a two-digit year to 20yy and returns UTC midnight', () => {
	assert.equal(parseDayMonthYear('01', '03', '26'), '2026-03-01T00:00:00.000Z');
	assert.equal(parseDayMonthYear('1', '3', '2026'), '2026-03-01T00:00:00.000Z');
});

test('parseDayMonthYear rejects impossible dates and implausible years', () => {
	assert.equal(parseDayMonthYear('31', '02', '26'), null);
	assert.equal(parseDayMonthYear('01', '01', '1999'), null);
	assert.equal(parseDayMonthYear('01', '01', '2101'), null);
});

test('parseDateIso routes ISO, German and slash dates through it', () => {
	assert.equal(parseDateIso('2026-03-01'), '2026-03-01T00:00:00.000Z');
	assert.equal(parseDateIso('01.03.26'), '2026-03-01T00:00:00.000Z');
	assert.equal(parseDateIso('03/01/2026'), '2026-03-01T00:00:00.000Z');
	assert.equal(parseDateIso('31.02.26'), null);
});

test('OCR dates use the same plausible-year bounds as the CSV import', () => {
	const contextDate = '2026-09-27T00:00:00.000Z';
	const parsed = parseOcrText('05.03.26 Pizza 12,50', contextDate);
	assert.equal(parsed.expenses[0]?.date, '2026-03-05T00:00:00.000Z');
	const implausible = parseOcrText('05.03.1850 Pizza 12,50', contextDate);
	assert.equal(implausible.expenses[0]?.date, contextDate);
});
