import assert from 'node:assert/strict';
import test from 'node:test';
import type { RejectedRow } from './import-types';

const { parseTricountCsv } = await import('./import-tricount-csv');

// Fixtures are written from the documented layout of Tricount's export (one "Impacted to <name>"
// column per person); the names and amounts are made up, not taken from a real group.
const COMMA_EXPORT = [
	'Title,Amount,Currency,Exchange rate,Amount in default currency,Date & time,Paid by,Transaction type,Category,Impacted to Anna,Impacted to Ben,Impacted to Cem',
	'Groceries,45.50,EUR,1,45.50,2026-09-12 07:15:00,Anna,Normal,Groceries,15.17,15.17,15.16',
	'Museum,25.00,EUR,1,25.00,2026-09-13 11:00:00,Ben,Normal,Entertainment,12.50,12.50,',
	'Back to Anna,30.00,EUR,1,30.00,2026-09-14 18:20:00,Cem,Money transfer,,30.00,,',
].join('\n');

const SEMICOLON_EXPORT = [
	'﻿Group: Summer flat',
	'Title;Amount (EUR);Date;Paid by;Transaction type;Impacted to Anna;Impacted to Ben',
	'Rent;1.200,00;01/10/2026 09:00;Anna;Expense;600,00;600,00',
	'Internet;29,99;13/10/2026 09:00;Ben;Expense;14,99;15,00',
].join('\r\n');

test('Tricount: a comma export becomes expenses with exact shares and a transfer marked as repayment', () => {
	const rejected: RejectedRow[] = [];
	const rows = parseTricountCsv(COMMA_EXPORT, rejected);
	assert.deepEqual(rejected, []);
	assert.equal(rows.length, 3);
	const [groceries, museum, transfer] = rows;
	assert.equal(groceries?.description, 'Groceries');
	assert.equal(groceries?.amountCents, 4550);
	assert.equal(groceries?.paidByName, 'Anna');
	assert.equal(groceries?.date, '2026-09-12T12:00:00.000Z');
	assert.deepEqual(groceries?.splits, [
		{ memberName: 'Anna', amountCents: 1517 },
		{ memberName: 'Ben', amountCents: 1517 },
		{ memberName: 'Cem', amountCents: 1516 },
	]);
	assert.deepEqual(museum?.splits, [
		{ memberName: 'Anna', amountCents: 1250 },
		{ memberName: 'Ben', amountCents: 1250 },
	]);
	assert.deepEqual(transfer?.splits, [{ memberName: 'Anna', amountCents: 3000 }]);
	assert.deepEqual(transfer?.warnings, ['payment_row']);
	for (const row of rows) {
		assert.equal(
			row.splits.reduce((acc, s) => acc + s.amountCents, 0),
			row.amountCents,
		);
	}
});

test('Tricount: a semicolon export with BOM, title line, decimal commas and day-first dates', () => {
	const rows = parseTricountCsv(SEMICOLON_EXPORT);
	assert.equal(rows.length, 2);
	assert.equal(rows[0]?.amountCents, 120000);
	assert.equal(rows[0]?.date, '2026-10-01T12:00:00.000Z');
	assert.equal(rows[1]?.date, '2026-10-13T12:00:00.000Z');
	assert.deepEqual(rows[1]?.splits, [
		{ memberName: 'Anna', amountCents: 1499 },
		{ memberName: 'Ben', amountCents: 1500 },
	]);
});

test('Tricount: month-first slash dates are read from the file itself', () => {
	const csv =
		'Title,Amount,Date,Paid by,Impacted to Anna\nA,5,10/13/2026,Anna,5\nB,5,10/02/2026,Anna,5';
	assert.deepEqual(
		parseTricountCsv(csv).map((r) => r.date),
		['2026-10-13T12:00:00.000Z', '2026-10-02T12:00:00.000Z'],
	);
});

test('Tricount: shares that miss the total are scaled to it and flagged', () => {
	const csv =
		'Title,Amount,Date,Paid by,Impacted to Anna,Impacted to Ben\nDinner,30,2026-10-01,Anna,10,10';
	const [row] = parseTricountCsv(csv);
	assert.deepEqual(row?.splits, [
		{ memberName: 'Anna', amountCents: 1500 },
		{ memberName: 'Ben', amountCents: 1500 },
	]);
	assert.deepEqual(row?.warnings, ['custom_splits_drift_adjusted']);
});

test('Tricount: income, several payers, foreign currency and unreadable rows are reported', () => {
	const rejected: RejectedRow[] = [];
	const csv = [
		'Title,Amount,Currency,Date,Paid by,Transaction type,Impacted to Anna,Impacted to Ben',
		'Refund,-20,EUR,2026-10-01,Anna,Income,10,10',
		'Gift,20,EUR,2026-10-01,Anna,Income,10,10',
		'Joint,20,EUR,2026-10-01,Anna;Ben,Normal,10,10',
		'Taxi,20,USD,2026-10-01,Anna,Normal,10,10',
		'Nobody,20,EUR,2026-10-01,Anna,Normal,,',
		'Bad date,20,EUR,someday,Anna,Normal,10,10',
		'Bad amount,abc,EUR,2026-10-01,Anna,Normal,10,10',
		'No payer,20,EUR,2026-10-01,,Normal,10,10',
		'Fine,20,EUR,2026-10-01,Anna,Normal,10,10',
	].join('\n');
	const rows = parseTricountCsv(csv, rejected);
	assert.deepEqual(
		rows.map((r) => r.description),
		['Fine'],
	);
	assert.deepEqual(
		rejected.map((r) => [r.line, r.reason]),
		[
			[2, 'income_unsupported'],
			[3, 'income_unsupported'],
			[4, 'multiple_payers'],
			[5, 'currency_unsupported'],
			[6, 'no_participants'],
			[7, 'date_invalid'],
			[8, 'amount_invalid'],
			[9, 'payer_missing'],
		],
	);
});

test('Tricount: a foreign currency row is never imported as euros, even without a rejected list', () => {
	const csv = 'Title,Amount,Currency,Date,Paid by,Impacted to Anna\nTaxi,20,USD,2026-10-01,Anna,20';
	assert.deepEqual(parseTricountCsv(csv), []);
});

test('Tricount: a row without a title is described by its people, a file without share columns is empty', () => {
	const csv = 'Title,Amount,Date,Paid by,Impacted to Anna,Impacted to Ben\n,8,2026-10-01,Anna,4,4';
	assert.equal(parseTricountCsv(csv)[0]?.description, 'Anna → Anna, Ben');
	assert.deepEqual(parseTricountCsv('Title,Amount,Date,Paid by\nA,1,2026-10-01,Anna'), []);
	assert.deepEqual(parseTricountCsv(''), []);
});

test('Tricount: negative share cells, year-first slash dates and a comma-joined payer cell', () => {
	const rejected: RejectedRow[] = [];
	const csv = [
		'Title,Amount,Date,Paid by,Impacted to Anna,Impacted to Ben',
		'Signed,20,2026/04/03,Anna,-10,-10',
		'"Joint",20,2026-04-03,"Anna, Ben",10,10',
	].join('\n');
	const rows = parseTricountCsv(csv, rejected);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.date, '2026-04-03T12:00:00.000Z');
	assert.deepEqual(rows[0]?.splits, [
		{ memberName: 'Anna', amountCents: 1000 },
		{ memberName: 'Ben', amountCents: 1000 },
	]);
	assert.deepEqual(
		rejected.map((r) => [r.line, r.reason]),
		[[3, 'multiple_payers']],
	);
});
