import assert from 'node:assert/strict';
import test from 'node:test';
import { DESCRIPTION_MAX_LENGTH } from './expense-constants';
import type { RejectedRow } from './import-types';

const { matchMembers, parseSplidCsv, parseSplitwiseCsv } = await import('./import-parsers');
const { parseAmountToCents } = await import('./import-csv-helpers');

test('parseSplitwiseCsv recovers the payer share from their net-balance column', () => {
	// Splitwise CSV convention: each person's column holds their NET balance for the row
	// (paid - ownShare for the payer, -share for everyone else), not their raw share. Taking
	// Math.abs() of every column would read the payer's net balance as their share, which is
	// wrong whenever the split is not 50/50 and would discard the real custom split as
	// unrepairable drift instead of importing it.
	const csv = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'2026-01-15,Miete,30.00,EUR,20.00,-20.00',
	].join('\n');

	const [expense] = parseSplitwiseCsv(csv);
	assert.ok(expense, 'expected one parsed expense');
	assert.equal(expense.amountCents, 3000);
	assert.equal(expense.paidByName, 'Anna');
	assert.equal(expense.warnings.includes('custom_splits_discarded'), false);

	const anna = expense.splits.find((s) => s.memberName === 'Anna');
	const bob = expense.splits.find((s) => s.memberName === 'Bob');
	// Anna paid 30 and her own share was 10 (net +20 = paid - ownShare).
	assert.equal(anna?.amountCents, 1000);
	// Bob's column already is his share (net -20 = -share).
	assert.equal(bob?.amountCents, 2000);
	assert.equal((anna?.amountCents ?? 0) + (bob?.amountCents ?? 0), expense.amountCents);
});

test('parseSplitwiseCsv still handles an equal split correctly', () => {
	const csv = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'2026-01-15,Miete,30.00,EUR,15.00,-15.00',
	].join('\n');

	const [expense] = parseSplitwiseCsv(csv);
	assert.ok(expense);
	const anna = expense.splits.find((s) => s.memberName === 'Anna');
	const bob = expense.splits.find((s) => s.memberName === 'Bob');
	assert.equal(anna?.amountCents, 1500);
	assert.equal(bob?.amountCents, 1500);
});

test('parseSplitwiseCsv reads UK slash dates day first for an English importer', () => {
	const csv = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'25/12/2026,Gift,30.00,EUR,15.00,-15.00',
		'03/01/2026,Rent,30.00,EUR,15.00,-15.00',
	].join('\n');
	const rejected: RejectedRow[] = [];

	const parsed = parseSplitwiseCsv(csv, rejected, 'en');
	assert.deepEqual(
		parsed.map((expense) => expense.date),
		['2026-12-25T12:00:00.000Z', '2026-01-03T12:00:00.000Z'],
	);
	assert.deepEqual(rejected, []);

	const german: RejectedRow[] = [];
	parseSplitwiseCsv(csv, german);
	assert.equal(german.length, 1);
	assert.equal(german[0]?.reason, 'date_invalid');
});

test('matchMembers does not guess between short names that differ by one letter', () => {
	const members = [{ id: 'tim', name: 'Tim' }];
	assert.equal(matchMembers(['Tom'], members).get('Tom'), null);
	assert.equal(matchMembers(['Jo'], [{ id: 'al', name: 'Al' }]).get('Jo'), null);
	assert.equal(matchMembers(['Anna'], [{ id: 'hana', name: 'Hana' }]).get('Anna'), null);
});

test('matchMembers still suggests longer names and flags them as fuzzy', () => {
	const fuzzy = new Set<string>();
	const matched = matchMembers(['Katharina'], [{ id: 'k', name: 'Katarina' }], fuzzy);
	assert.equal(matched.get('Katharina'), 'k');
	assert.deepEqual([...fuzzy], ['Katharina']);
	const exact = new Set<string>();
	assert.equal(matchMembers(['TIM'], [{ id: 'tim', name: 'Tim' }], exact).get('TIM'), 'tim');
	assert.equal(exact.size, 0);
});

test('matchMembers never reuses a member that another name already matches exactly', () => {
	const members = [{ id: 'katarina', name: 'Katarina' }];
	const matched = matchMembers(['Katarina', 'Katharina'], members);
	assert.equal(matched.get('Katarina'), 'katarina');
	assert.equal(matched.get('Katharina'), null);
});

test('parsers report rows they cannot read instead of dropping them silently', () => {
	const splitwise = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'2026-01-15,Miete,30.00,EUR,15.00,-15.00',
		'kaputt,Strom,30.00,EUR,15.00,-15.00',
		'2026-01-16,Wasser,abc,EUR,15.00,-15.00',
	].join('\n');
	const rejected: RejectedRow[] = [];
	assert.equal(parseSplitwiseCsv(splitwise, rejected).length, 1);
	assert.deepEqual(rejected, [
		{ line: 3, reason: 'date_invalid', description: 'Strom' },
		{ line: 4, reason: 'amount_invalid', description: 'Wasser' },
	]);

	const splid = [
		'Datum,Beschreibung,Betrag,Bezahlt von,Teilnehmer',
		'2026-01-15,Pizza,12.00,,Anna',
	].join('\n');
	const splidRejected: RejectedRow[] = [];
	assert.equal(parseSplidCsv(splid, splidRejected).length, 0);
	assert.deepEqual(splidRejected, [{ line: 2, reason: 'payer_missing', description: 'Pizza' }]);
});

test('a reported foreign-currency row is never imported as euros', () => {
	const splitwise = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'2026-01-15,Miete,30.00,EUR,15.00,-15.00',
		'2026-01-16,Dollar,5.00,USD,2.50,-2.50',
	].join('\n');
	const rejected: RejectedRow[] = [];
	const parsed = parseSplitwiseCsv(splitwise, rejected);
	assert.deepEqual(
		parsed.map((row) => row.description),
		['Miete'],
	);
	assert.deepEqual(rejected, [
		{ line: 3, reason: 'currency_unsupported', description: 'Dollar (USD)' },
	]);

	const splid = [
		'Datum,Beschreibung,Betrag,Währung,Bezahlt von,Teilnehmer',
		'2026-01-15,Pizza,12.00,EUR,Anna,Anna;Bob',
		'2026-01-16,Franken,12.00,CHF,Anna,Anna;Bob',
	].join('\n');
	const splidRejected: RejectedRow[] = [];
	assert.deepEqual(
		parseSplidCsv(splid, splidRejected).map((row) => row.description),
		['Pizza'],
	);
	assert.deepEqual(splidRejected, [
		{ line: 3, reason: 'currency_unsupported', description: 'Franken (CHF)' },
	]);
});

test('a Splitwise row with several payers is reported, not booked on one of them', () => {
	const csv = [
		'Date,Description,Cost,Currency,A,B,C,D',
		'2026-01-15,Dinner,100.00,EUR,25.00,25.00,-25.00,-25.00',
	].join('\n');
	const rejected: RejectedRow[] = [];
	assert.equal(parseSplitwiseCsv(csv, rejected).length, 0);
	assert.deepEqual(rejected, [{ line: 2, reason: 'multiple_payers', description: 'Dinner' }]);
});

test('parseSplitwiseCsv keeps expenses whose description starts with "Total" and skips the balance footer', () => {
	const csv = [
		'Date,Description,Cost,Currency,Anna,Bob',
		'2026-01-15,TotalEnergies fuel,50.00,EUR,25.00,-25.00',
		',Total balance, ,EUR,0.00,0.00',
	].join('\n');
	const rejected: RejectedRow[] = [];
	const parsed = parseSplitwiseCsv(csv, rejected);
	assert.deepEqual(
		parsed.map((e) => e.description),
		['TotalEnergies fuel'],
	);
	assert.equal(rejected.length, 0);
});

test('imported descriptions are capped at the description limit without a trailing space', () => {
	const long = `${'a'.repeat(DESCRIPTION_MAX_LENGTH - 1)} ${'b'.repeat(100)}`;
	const splitwise = [
		'Date,Description,Cost,Currency,Anna,Bob',
		`2026-01-15,${long},30.00,EUR,20.00,-20.00`,
	];
	const splid = [
		'Datum,Beschreibung,Betrag,Bezahlt von,Teilnehmer',
		`2026-01-15,${long},12.00,Anna,Anna`,
	];
	const expected = 'a'.repeat(DESCRIPTION_MAX_LENGTH - 1);
	assert.equal(parseSplitwiseCsv(splitwise.join('\n'))[0]?.description, expected);
	assert.equal(parseSplidCsv(splid.join('\n'))[0]?.description, expected);
});

test('parseAmountToCents rejects a thousands group that starts with zero', () => {
	assert.equal(parseAmountToCents('0,001'), null);
	assert.equal(parseAmountToCents('0,125'), null);
	assert.equal(parseAmountToCents('1,234'), 123400);
});
