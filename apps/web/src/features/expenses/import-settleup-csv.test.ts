import assert from 'node:assert/strict';
import test from 'node:test';
import type { RejectedRow } from './import-types';

const { parseSettleUpCsv } = await import('./import-settleup-csv');

// Fixtures follow the documented columns of Settle Up's CSV export (names joined by ";" in "For
// whom", one amount per name in "Split amounts"); the people and amounts are made up.
const HEADER =
	'Who paid,Amount,Currency,For whom,Split amounts,Purpose,Category,Date & time,Timezone,Exchange rate,Converted amount,Type,Receipt';
const EXPORT = [
	HEADER,
	'Anna,60,EUR,Anna;Ben;Cem,20;20;20,Groceries,Food,2026-06-01 10:00:00,+02:00,,60,expense,',
	'Ben,100,EUR,Anna;Ben,70;30,Boat trip,,2026-06-02 12:30:00,,,100,expense,',
	'Cem,8.11,EUR,Anna;Cem,4.055;4.055,Kiosk,,2026-06-03 09:00:00,,,8.11,expense,',
	'Ben,20,EUR,Anna,20,,,2026-06-04 09:00:00,,,20,transfer,',
].join('\n');

test('Settle Up: expenses use the listed amounts, sub-cent halves still add up to the total', () => {
	const rejected: RejectedRow[] = [];
	const rows = parseSettleUpCsv(EXPORT, rejected);
	assert.deepEqual(rejected, []);
	assert.equal(rows.length, 4);
	assert.deepEqual(rows[0]?.splits, [
		{ memberName: 'Anna', amountCents: 2000 },
		{ memberName: 'Ben', amountCents: 2000 },
		{ memberName: 'Cem', amountCents: 2000 },
	]);
	assert.equal(rows[0]?.date, '2026-06-01T12:00:00.000Z');
	assert.deepEqual(rows[1]?.splits, [
		{ memberName: 'Anna', amountCents: 7000 },
		{ memberName: 'Ben', amountCents: 3000 },
	]);
	assert.deepEqual(rows[2]?.splits, [
		{ memberName: 'Anna', amountCents: 406 },
		{ memberName: 'Cem', amountCents: 405 },
	]);
	assert.deepEqual(rows[2]?.warnings, []);
	for (const row of rows) {
		assert.equal(
			row.splits.reduce((acc, s) => acc + s.amountCents, 0),
			row.amountCents,
		);
	}
});

test('Settle Up: a transfer is a repayment row and a blank purpose falls back to the people', () => {
	const [, , , transfer] = parseSettleUpCsv(EXPORT);
	assert.equal(transfer?.description, 'Ben → Anna');
	assert.equal(transfer?.paidByName, 'Ben');
	assert.deepEqual(transfer?.splits, [{ memberName: 'Anna', amountCents: 2000 }]);
	assert.deepEqual(transfer?.warnings, ['payment_row']);
});

test('Settle Up: without usable split amounts everyone takes an equal share', () => {
	const csv = [
		HEADER,
		'Anna,10,EUR,Anna;Ben;Cem,,Pizza,,2026-06-01 10:00:00,,,,expense,',
		'Anna,10,EUR,Anna;Ben,5,Mismatch,,2026-06-01 10:00:00,,,,expense,',
	].join('\n');
	const [equal, mismatch] = parseSettleUpCsv(csv);
	assert.deepEqual(
		equal?.splits.map((s) => s.amountCents),
		[334, 333, 333],
	);
	assert.deepEqual(equal?.warnings, []);
	assert.deepEqual(
		mismatch?.splits.map((s) => s.amountCents),
		[500, 500],
	);
	assert.deepEqual(mismatch?.warnings, ['custom_splits_discarded']);
});

test('Settle Up: split ratios are scaled to the amount and flagged for a check', () => {
	const csv = `${HEADER}\nBen,6.6,EUR,Anna;Ben,3;1,Drinks,,2026-06-01 10:00:00,,,,expense,`;
	const [row] = parseSettleUpCsv(csv);
	assert.deepEqual(row?.splits, [
		{ memberName: 'Anna', amountCents: 495 },
		{ memberName: 'Ben', amountCents: 165 },
	]);
	assert.deepEqual(row?.warnings, ['custom_splits_drift_adjusted']);
});

test('Settle Up: older exports without timezone and receipt columns, with a sep line, are read', () => {
	const csv = [
		'sep=,',
		'Who paid,Amount,Currency,For whom,Split amounts,Purpose,Date & time,Exchange rate,Type',
		'Anna,"12,50",EUR,Anna;Ben,6.25;6.25,Lunch,2017-10-14 12:35:58,,expense',
	].join('\r\n');
	const [row] = parseSettleUpCsv(csv);
	assert.equal(row?.amountCents, 1250);
	assert.equal(row?.description, 'Lunch');
});

test('Settle Up: foreign currency, several payers and unreadable rows are reported', () => {
	const rejected: RejectedRow[] = [];
	const csv = [
		HEADER,
		'Anna,50,GBP,Anna;Ben,,Pub,,2026-06-03 21:00:00,,1.17,58.5,expense,',
		'Anna;Ben,10;20,EUR,Cem,,Taxi,,2026-06-05 09:00:00,,,,expense,',
		'Anna,0,EUR,Ben,0,Zero,,2026-06-05 09:00:00,,,,expense,',
		'Anna,5,EUR,Ben,5,Bad date,,tomorrow,,,,expense,',
		',5,EUR,Ben,5,No payer,,2026-06-05 09:00:00,,,,expense,',
		'Anna,5,EUR,,,Nobody,,2026-06-05 09:00:00,,,,expense,',
		'Anna,5,EUR,Ben,5,Fine,,2026-06-05 09:00:00,,,,expense,',
	].join('\n');
	const rows = parseSettleUpCsv(csv, rejected);
	assert.deepEqual(
		rows.map((r) => r.description),
		['Fine'],
	);
	assert.deepEqual(
		rejected.map((r) => [r.line, r.reason]),
		[
			[2, 'currency_unsupported'],
			[3, 'multiple_payers'],
			[4, 'amount_invalid'],
			[5, 'date_invalid'],
			[6, 'payer_missing'],
			[7, 'no_participants'],
		],
	);
});

test('Settle Up: a file of another app or without rows yields nothing', () => {
	assert.deepEqual(
		parseSettleUpCsv('Date,Description,Cost,Currency,Anna\n2026-01-01,A,5,EUR,5'),
		[],
	);
	assert.deepEqual(parseSettleUpCsv(HEADER), []);
	assert.deepEqual(parseSettleUpCsv(''), []);
});
