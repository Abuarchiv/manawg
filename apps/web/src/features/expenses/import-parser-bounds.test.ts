import assert from 'node:assert/strict';
import test from 'node:test';
import type { RejectedRow } from './import-types';

const { matchMembers, parseSplidCsv, parseSplitwiseCsv } = await import('./import-parsers');
const { parseAmountToCents, parseCsv } = await import('./import-csv-helpers');

const SPLITWISE_HEAD = 'Date,Description,Cost,Currency,Anna,Ben\n';

test('parseCsv unescapes a doubled quote inside a quoted field', () => {
	const rows = parseCsv('a,b\n"Pizza ""Margherita"" XL",2', ',');
	assert.equal(rows[1]?.fields[0], 'Pizza "Margherita" XL');
});

test('parseAmountToCents accepts exactly the 1.000.000,00 maximum and rejects one cent more', () => {
	assert.equal(parseAmountToCents('1.000.000,00'), 100_000_000);
	assert.equal(parseAmountToCents('1.000.000,01'), null);
	assert.equal(parseAmountToCents('-1.000.000,01'), null);
});

test('Splid import splits 1,04 EUR over five people as 21/21/21/21/20', () => {
	const csv = 'Datum;Titel;Betrag;Zahler;Teilnehmer\n01.10.2026;Kaffee;1,04;A;A,B,C,D,E';
	const [row] = parseSplidCsv(csv, []);
	assert.deepEqual(
		row?.splits.map((s) => s.amountCents),
		[21, 21, 21, 21, 20],
	);
});

test('Splitwise: a drift of 2 cents is absorbed by the largest share, 3 cents discards the custom split', () => {
	const [adjusted] = parseSplitwiseCsv(`${SPLITWISE_HEAD}2026-01-15,Miete,30.00,EUR,20.00,-20.02`);
	assert.ok(adjusted?.warnings.includes('custom_splits_drift_adjusted'));
	assert.deepEqual(
		adjusted?.splits.map((s) => s.amountCents),
		[1000, 2000],
	);
	const [discarded] = parseSplitwiseCsv(`${SPLITWISE_HEAD}2026-01-15,Miete,30.00,EUR,20.00,-20.03`);
	assert.ok(discarded?.warnings.includes('custom_splits_discarded'));
	assert.equal(discarded?.warnings.includes('custom_splits_drift_adjusted'), false);
});

test('Splitwise: a zero or negative total is rejected as amount_invalid', () => {
	const rejected: RejectedRow[] = [];
	const rows = parseSplitwiseCsv(
		`${SPLITWISE_HEAD}2026-01-15,Null,0.00,EUR,0.00,0.00\n2026-01-16,Minus,-5.00,EUR,-5.00,5.00`,
		rejected,
	);
	assert.equal(rows.length, 0);
	assert.deepEqual(
		rejected.map((r) => r.reason),
		['amount_invalid', 'amount_invalid'],
	);
});

test('Splitwise: a discarded custom split falls back to an equal split without the 0,00 column', () => {
	const [row] = parseSplitwiseCsv(
		'Date,Description,Cost,Currency,Anna,Ben,Cy\n2026-01-15,Gas,30.00,EUR,20.00,-5.00,0.00',
	);
	assert.deepEqual(
		row?.splits.map((s) => [s.memberName, s.amountCents]),
		[
			['Anna', 1500],
			['Ben', 1500],
		],
	);
});

test('Splitwise: the equal-split fallback gives the odd cent to the first participant', () => {
	const [row] = parseSplitwiseCsv(`${SPLITWISE_HEAD}2026-01-15,Gas,10.01,EUR,8.00,-1.00`);
	assert.deepEqual(
		row?.splits.map((s) => s.amountCents),
		[501, 500],
	);
});

test('matchMembers allows two edits only for names of nine letters or more', () => {
	assert.equal(matchMembers(['Daniel'], [{ id: 'm', name: 'Danila' }]).get('Daniel'), null);
	assert.equal(matchMembers(['Alexander'], [{ id: 'x', name: 'Alexandre' }]).get('Alexander'), 'x');
});
