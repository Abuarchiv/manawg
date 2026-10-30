import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { buildExportSummaryFromCounts, getExportSectionHeaders, toCsv } from './export';

const tables = Object.fromEntries(
	[
		'announcementComments',
		'announcements',
		'auditEvents',
		'choreCompletions',
		'chores',
		'expensePayments',
		'expenseSplits',
		'expenses',
		'memberAbsences',
		'recurringExpenses',
		'shoppingItems',
		'wgChatMessages',
		'wgEvents',
		'wgInventoryItems',
		'wgMembers',
	].map((name) => [name, {}]),
);
mock.module('@/core/db', { namedExports: { db: {}, ...tables } });
const { mapExpenseRows, mapRecurringRows } = await import('./export-queries-finance');
const { mapInventoryRows, mapShoppingRows } = await import('./export-queries-household');
const { mapAuditRows } = await import('./export-queries-community');

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

const NAMES = new Map([['m1', 'Anna']]);
const AT = new Date('2026-03-30T10:30:00.000Z');
const STORED = 'Anna hat Putzplan aktualisiert.';

function localizedRows(locale: 'de' | 'en') {
	const expense = (category: string) =>
		({ ...ROW, category, occurredAt: AT, imageUrl: null, amountCents: 100, id: category }) as never;
	const recurring = {
		id: 'r1',
		category: 'housing',
		paidByMemberId: 'm1',
		nextDueAt: AT,
		createdAt: AT,
	};
	const shopping = (boughtAt: Date | null) =>
		({
			id: 's',
			name: 'Milch',
			quantity: null,
			addedByMemberId: 'm1',
			boughtAt,
			createdAt: AT,
		}) as never;
	return {
		categories: ['groceries', 'housing', 'transport', 'other', 'unknown'].map(
			(code) => mapExpenseRows([expense(code)], NAMES, new Map(), locale)[0]?.category,
		),
		recurring: mapRecurringRows([recurring as never], NAMES, locale)[0]?.category,
		status: [shopping(AT), shopping(null)].map(
			(item) => mapShoppingRows([item], NAMES, locale)[0]?.status,
		),
		audit: mapAuditRows(
			[
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'chore.updated',
					entityType: 'chore',
					summary: STORED,
					metadataJson: JSON.stringify({ title: 'Bins' }),
					createdAt: AT,
				},
				{
					id: 'a2',
					memberId: 'm1',
					eventType: 'chore.updated',
					entityType: 'chore',
					summary: STORED,
					metadataJson: null,
					createdAt: AT,
				},
			],
			NAMES,
			locale,
		).map((row) => row.summary),
	};
}

test('the German export keeps its category names, shopping status and stored audit sentence', () => {
	const rows = localizedRows('de');
	assert.deepEqual(rows.categories, [
		'Lebensmittel',
		'Wohnen & Nebenkosten',
		'Mobilität',
		'Sonstiges',
		'Sonstiges',
	]);
	assert.equal(rows.recurring, 'Wohnen & Nebenkosten');
	assert.deepEqual(rows.status, ['erledigt', 'offen']);
	assert.deepEqual(rows.audit, [STORED, STORED]);
});

test('the English export names categories and status in English and re-renders the audit sentence', () => {
	const rows = localizedRows('en');
	assert.deepEqual(rows.categories, ['Groceries', 'Housing', 'Transport', 'Other', 'Other']);
	assert.equal(rows.recurring, 'Housing');
	assert.deepEqual(rows.status, ['bought', 'open']);
	assert.match(rows.audit[0] ?? '', /^Anna updated .*Bins/);
	assert.equal(rows.audit[1], STORED);
});

const AT_CREATED = new Date('2026-03-30T10:00:00Z');
const INVENTORY = [
	{ id: 'i1', name: 'Milk', quantity: 1.5, unit: 'litre', threshold: 0.5, category: 'kitchen' },
	{ id: 'i2', name: 'Tape', quantity: 1, unit: 'roll', threshold: 0, category: 'legacy' },
].map((row) => ({ ...row, lastDecrementedAt: null, createdAt: AT_CREATED }));

test('the inventory export names unit and category in the reader language', () => {
	const de = mapInventoryRows(INVENTORY as never, 'de');
	assert.deepEqual(
		de.map((row) => [row.unit, row.category]),
		[
			['L', 'Küche'],
			['Rolle', 'Sonstiges'],
		],
	);
	const en = mapInventoryRows(INVENTORY as never, 'en');
	assert.deepEqual(
		en.map((row) => [row.unit, row.category]),
		[
			['L', 'Kitchen'],
			['roll', 'Other'],
		],
	);
});

test('CSV writes fractional numbers with the locale decimal mark', () => {
	const headers = ['name', 'quantity', 'threshold'];
	const rows = [{ name: 'Milk', quantity: 1.5, threshold: 3 }];
	assert.equal(toCsv(rows, headers, 'de'), '\uFEFFname;quantity;threshold\nMilk;1,5;3');
	assert.equal(toCsv(rows, headers, 'en'), '\uFEFFname,quantity,threshold\nMilk,1.5,3');
});
