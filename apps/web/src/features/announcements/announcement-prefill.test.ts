import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnouncementPrefill } from './announcement-prefill';

test('recognises the amount with € / EUR / Euro after or € before the number', () => {
	const cases: [string, string | null, string][] = [
		['Internet kostet 35 Euro im Monat', '35', 'Internet kostet im Monat'],
		['Putzmittel 5 euro', '5', 'Putzmittel'],
		['Strom € 35,50', '35,50', 'Strom'],
		['Pizza 35 EUR.', '35', 'Pizza'],
		['Miete 1.234,50 €', '1234,50', 'Miete'],
		['Nebenkosten 1.200 Euro', '1200', 'Nebenkosten'],
		['Pizza 12,5 EUR', '12,5', 'Pizza'],
		['Bier 35€', '35', 'Bier'],
	];
	for (const [input, amountStr, title] of cases) {
		assert.deepEqual(buildAnnouncementPrefill(input, 'de'), { title, amountStr }, input);
	}
});

test('does not mistake other words or numbers for an amount', () => {
	assert.equal(buildAnnouncementPrefill('Das ist 5 europäisch', 'de').amountStr, null);
	assert.equal(buildAnnouncementPrefill('Zimmer 12 Uhr', 'de').amountStr, null);
});

test('reads English amounts with comma grouping and a decimal point', () => {
	const cases: [string, string | null, string][] = [
		['Internet bill €1,234.50 this month', '1234.50', 'Internet bill this month'],
		['Rent is €1,200', '1200', 'Rent is'],
		['Lamp 12.50 EUR', '12.50', 'Lamp'],
		['1,234.50 EUR rent', '1234.50', 'rent'],
		['Pizza 35 EUR.', '35', 'Pizza'],
	];
	for (const [input, amountStr, title] of cases) {
		assert.deepEqual(buildAnnouncementPrefill(input, 'en'), { title, amountStr }, input);
	}
});
