import assert from 'node:assert/strict';
import test from 'node:test';
import type { RejectedRow } from './import-types';

const { parseSplidCsv } = await import('./import-splid-csv');

const HEADER = 'Datum,Beschreibung,Betrag,Bezahlt von,Teilnehmer,Währung';

test('Splid participants split on comma, semicolon and bar, trimmed, empty names dropped', () => {
	const [expense] = parseSplidCsv(`${HEADER}\n2026-10-01,Pizza,10,Anna," Anna , Ben;; Cem |",eur`);
	assert.deepEqual(expense?.splits, [
		{ memberName: 'Anna', amountCents: 334 },
		{ memberName: 'Ben', amountCents: 333 },
		{ memberName: 'Cem', amountCents: 333 },
	]);
	assert.equal(expense?.currency, 'EUR');
});

test('a Splid row books the trimmed payer alone when no participants are listed', () => {
	const withEmpty = parseSplidCsv(`${HEADER}\n2026-10-01,Pizza,10, Anna ,,EUR`);
	const withoutColumn = parseSplidCsv(
		'Datum,Beschreibung,Betrag,Bezahlt von\n2026-10-01,Pizza,10, Anna ',
	);
	for (const [expense] of [withEmpty, withoutColumn]) {
		assert.equal(expense?.paidByName, 'Anna');
		assert.deepEqual(expense?.splits, [{ memberName: 'Anna', amountCents: 1000 }]);
	}
});

test('a Splid row of zero euros is reported and an empty description row is skipped', () => {
	const rejected: RejectedRow[] = [];
	const csv = `${HEADER}\n2026-10-01,Pizza,0,Anna,Anna,EUR\n2026-10-02,,5,Anna,Anna,EUR`;
	assert.deepEqual(parseSplidCsv(csv, rejected), []);
	assert.deepEqual(rejected, [{ line: 2, reason: 'amount_invalid', description: 'Pizza' }]);
});

test('a Splid file without a payer column, without rows or with a BOM is read as expected', () => {
	const rejected: RejectedRow[] = [];
	assert.deepEqual(parseSplidCsv('Datum,Beschreibung,Betrag\n2026-10-01,Pizza,10', rejected), []);
	assert.deepEqual(rejected, []);
	assert.deepEqual(parseSplidCsv(HEADER), []);
	const [expense] = parseSplidCsv(
		'﻿Datum;Beschreibung;Betrag;Bezahlt von\n01.10.2026;Pizza;10,00;Anna',
	);
	assert.equal(expense?.amountCents, 1000);
	assert.equal(expense?.date, '2026-10-01T12:00:00.000Z');
});
