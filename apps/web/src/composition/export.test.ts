import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExportSummaryFromCounts, getExportSectionHeaders, toCsv } from './export';

const ROW = {
	id: 'e1',
	description: 'Reis, Bohnen',
	category: 'groceries',
	amountCents: -123456,
	currency: 'EUR',
	paidBy: 'Anna',
	paidByMemberId: 'm1',
	imageUrl: null,
	occurredAt: '2026-03-30T10:30:00.000Z',
	splits: [
		{ debtor: 'Ben', amountCents: 6000 },
		{ debtor: 'Cem', amountCents: 5 },
	],
};
const HEADERS = getExportSectionHeaders('expenses');

test('the German CSV keeps the semicolon separator and the decimal comma', () => {
	assert.equal(
		toCsv([ROW], HEADERS),
		'﻿id;description;category;amount;currency;paidBy;paidByMemberId;imageUrl;occurredAt;splits\n' +
			'e1;Reis, Bohnen;groceries;-1234,56;EUR;Anna;m1;;2026-03-30 12:30;"Ben: 60,00; Cem: 0,05"',
	);
	assert.equal(toCsv([ROW], HEADERS, 'de'), toCsv([ROW], HEADERS));
});

test('the English CSV separates with a comma and writes a decimal point', () => {
	assert.equal(
		toCsv([ROW], HEADERS, 'en'),
		'﻿id,description,category,amount,currency,paidBy,paidByMemberId,imageUrl,occurredAt,splits\n' +
			'e1,"Reis, Bohnen",groceries,-1234.56,EUR,Anna,m1,,2026-03-30 12:30,Ben: 60.00; Cem: 0.05',
	);
});

test('a cell holding the separator is quoted in its own locale only', () => {
	const rows = [{ name: 'a;b', other: 'c,d', quote: 'say "hi"' }];
	assert.equal(toCsv(rows, [], 'de'), '﻿name;other;quote\n"a;b";c,d;"say ""hi"""');
	assert.equal(toCsv(rows, [], 'en'), '﻿name,other,quote\na;b,"c,d","say ""hi"""');
});

test('the summary lists every section with its count', () => {
	const summary = buildExportSummaryFromCounts({ members: 2 } as never);
	assert.equal(summary.length, 14);
	assert.deepEqual(summary[0], { key: 'members', count: 2 });
	assert.deepEqual(summary[1], { key: 'expenses', count: 0 });
});
