import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNetBalances, simplifyDebts } from './debt-reduction';
import type { ExpensePaymentInput } from './expense-payment-input';
import {
	buildMonthlyStatement,
	type StatementExpense,
	type StatementMemberInput,
	shiftMonthKey,
} from './monthly-statement';

const AS_OF = new Date('2026-11-04T09:00:00Z');
const build = (
	expenses: StatementExpense[],
	people: StatementMemberInput[],
	monthKey: string,
	payments: ExpensePaymentInput[] = [],
) => buildMonthlyStatement(expenses, people, monthKey, payments, AS_OF);

const members = [
	{ id: 'L', name: 'Lina', active: true },
	{ id: 'J', name: 'Jonas', active: true },
	{ id: 'M', name: 'Mira', active: false },
];

function expense(
	id: string,
	paidBy: string,
	occurredAt: string,
	shares: Record<string, number>,
	settledAt: string | null = null,
) {
	const splits = Object.entries(shares).map(([debtorMemberId, amountCents]) => ({
		debtorMemberId,
		amountCents,
		settledAt,
	}));
	return {
		id,
		paidByMemberId: paidBy,
		amountCents: splits.reduce((sum, split) => sum + split.amountCents, 0),
		currency: 'EUR',
		description: id,
		occurredAt,
		splits,
	};
}

test('month balances, Berlin month edges and fewest transfers', () => {
	const statement = build(
		[
			expense('a', 'L', '2026-09-02T10:00:00Z', { L: 1000, J: 1000 }),
			expense('b', 'J', '2026-09-03T10:00:00Z', { L: 300, J: 300 }, '2026-09-04T00:00:00Z'),
			// 30.09. 23:30 UTC is already 01.10. in Berlin.
			expense('c', 'L', '2026-09-30T23:30:00Z', { L: 500, J: 500 }),
			// 31.08. 22:30 UTC is 01.09. in Berlin.
			expense('d', 'J', '2026-08-31T22:30:00Z', { J: 200, L: 200 }),
		],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.items.map((item) => item.id),
		['d', 'a', 'b'],
	);
	assert.equal(statement.totalCents, 2000 + 600 + 400);
	assert.deepEqual(
		statement.members.map(({ id, paidCents, shareCents }) => [id, paidCents, shareCents]),
		[
			['L', 2000, 1500],
			['J', 1000, 1500],
		],
	);
	// Open over all months: J owes 1000 and 500, L owes 200; the settled 300 of "b" is not open.
	assert.deepEqual(
		statement.open.map(({ memberId, cents }) => [memberId, cents]),
		[
			['J', -1300],
			['L', 1300],
		],
	);
	assert.deepEqual(
		statement.transfers.map(({ fromId, toId, cents }) => [fromId, toId, cents]),
		[['J', 'L', 1300]],
	);
	assert.equal(statement.settled, false);
});

test('categories are summed per month, largest first, "other" last', () => {
	const withCategory = (category: string | undefined, id: string, cents: number) => ({
		...expense(id, 'L', '2026-09-10T10:00:00Z', { L: cents }),
		...(category ? { category } : {}),
	});
	const statement = build(
		[
			withCategory('other', 'a', 10000),
			withCategory('leisure', 'b', 2000),
			withCategory('groceries', 'c', 5000),
			withCategory('groceries', 'd', 1000),
			// Missing or unknown categories count as "other".
			withCategory(undefined, 'e', 1000),
			withCategory('unbekannt', 'f', 1000),
		],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.categories.map(({ category, cents, share }) => [category, cents, share]),
		[
			['groceries', 6000, 30],
			['leisure', 2000, 10],
			['other', 12000, 60],
		],
	);
});

test('a payer missing from the members list has no name', () => {
	const statement = build(
		[expense('a', 'X', '2026-09-02T10:00:00Z', { L: 1000 })],
		members,
		'2026-09',
	);
	assert.equal(statement.items[0]?.payerName, null);
});

test('month key arithmetic crosses years', () => {
	assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
	assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
});

test('open balances count every month, so a chain payment settles both statements', () => {
	// B paid for A in January, C paid for B in February; A paid C directly.
	const expenses = [
		expense('jan', 'B', '2026-01-10T10:00:00Z', { A: 1000 }),
		expense('feb', 'C', '2026-02-10T10:00:00Z', { B: 1000 }),
	];
	const people = [
		{ id: 'A', name: 'Anna', active: true },
		{ id: 'B', name: 'Ben', active: true },
		{ id: 'C', name: 'Cem', active: true },
	];
	const payments = [
		{
			fromMemberId: 'A',
			toMemberId: 'C',
			amountCents: 1000,
			currency: 'EUR',
			completedAt: '2026-02-20T10:00:00Z',
		},
	];
	for (const month of ['2026-01', '2026-02']) {
		const statement = build(expenses, people, month, payments);
		assert.deepEqual(statement.open, []);
		assert.deepEqual(statement.transfers, []);
		assert.equal(statement.settled, true);
	}
});

const ledgerMembers = [
	{ id: 'A', name: 'Anna', active: true },
	{ id: 'B', name: 'Ben', active: true },
	{ id: 'C', name: 'Cem', active: true },
	{ id: 'D', name: 'Dora', active: true },
];

test('open balances and transfers equal the expenses page ledger', () => {
	const usd = (value: StatementExpense): StatementExpense => ({ ...value, currency: 'USD' });
	const expenses = [
		expense('a', 'A', '2026-08-03T10:00:00Z', { A: 900, B: 700, C: 400 }),
		expense('b', 'B', '2026-09-05T10:00:00Z', { A: 1200, B: 300, D: 800 }),
		usd(expense('c', 'C', '2026-09-12T10:00:00Z', { A: 500, C: 500, D: 500 })),
		expense('d', 'D', '2026-10-01T10:00:00Z', { A: 250, B: 250, C: 250, D: 250 }),
		expense('e', 'A', '2026-10-09T10:00:00Z', { B: 600, C: 300 }, '2026-10-10T10:00:00Z'),
	];
	const payments: ExpensePaymentInput[] = [
		{
			fromMemberId: 'C',
			toMemberId: 'A',
			amountCents: 300,
			currency: 'EUR',
			completedAt: '2026-09-01T10:00:00Z',
		},
		{
			fromMemberId: 'D',
			toMemberId: 'C',
			amountCents: 200,
			currency: 'USD',
			completedAt: '2026-10-02T10:00:00Z',
		},
	];
	const statement = build(expenses, ledgerMembers, '2026-09', payments);
	const balances = computeNetBalances(
		expenses,
		ledgerMembers.map((member) => ({ ...member, color: null })),
		payments,
	);
	const key = (memberId: string, currency: string) => `${memberId}:${currency}`;
	assert.deepEqual(
		Object.fromEntries(statement.open.map((row) => [key(row.memberId, row.currency), row.cents])),
		Object.fromEntries(
			balances
				.filter((row) => row.cents !== 0)
				.map((row) => [key(row.memberId, row.currency), row.cents]),
		),
	);
	assert.deepEqual(statement.transfers, simplifyDebts(balances));
	assert.ok(statement.open.some((row) => row.currency === 'USD'));
	assert.equal(statement.settled, false);
	assert.equal(statement.asOf, AS_OF.toISOString());
});

test('open balances list EUR first, then other currencies, each sorted by name', () => {
	const statement = build(
		[
			{ ...expense('usd', 'L', '2026-09-02T10:00:00Z', { J: 400 }), currency: 'USD' },
			{ ...expense('chf', 'J', '2026-09-03T10:00:00Z', { L: 300 }), currency: 'CHF' },
			expense('eur', 'J', '2026-09-04T10:00:00Z', { L: 1000 }),
		],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.open.map((row) => `${row.currency}:${row.name}:${row.cents}`),
		[
			'EUR:Jonas:1000',
			'EUR:Lina:-1000',
			'CHF:Jonas:300',
			'CHF:Lina:-300',
			'USD:Jonas:-400',
			'USD:Lina:400',
		],
	);
});

test('the month part ignores other months while the open part includes them', () => {
	const statement = build(
		[
			expense('sep', 'L', '2026-09-02T10:00:00Z', { J: 1000 }),
			expense('oct', 'L', '2026-10-05T10:00:00Z', { J: 500 }),
		],
		members,
		'2026-09',
	);
	assert.equal(statement.totalCents, 1000);
	assert.deepEqual(
		statement.items.map((item) => item.id),
		['sep'],
	);
	assert.deepEqual(
		statement.members.map(({ id, paidCents, shareCents }) => [id, paidCents, shareCents]),
		[
			['L', 1000, 0],
			['J', 0, 1000],
		],
	);
	assert.deepEqual(
		statement.open.map(({ memberId, cents }) => [memberId, cents]),
		[
			['J', -1500],
			['L', 1500],
		],
	);
});

test('a former member shows in the open part while a balance is left', () => {
	const statement = build(
		[expense('a', 'J', '2026-08-02T10:00:00Z', { L: 1000, M: 1000 })],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.members.map((row) => row.id),
		['L', 'J', 'M'],
	);
	assert.deepEqual(
		statement.open.map(({ memberId, cents }) => [memberId, cents]),
		[
			['J', 2000],
			['L', -1000],
			['M', -1000],
		],
	);
	assert.equal(
		statement.transfers.filter((transfer) => transfer.fromId === 'M' && transfer.toId === 'J')
			.length,
		1,
	);
});

test('partial and later payments reduce the open amount and settle it fully', () => {
	const expenses = [expense('a', 'L', '2026-09-02T10:00:00Z', { L: 2000, J: 1000 })];
	const payment = (completedAt: string, cents: number): ExpensePaymentInput => ({
		fromMemberId: 'J',
		toMemberId: 'L',
		amountCents: cents,
		currency: 'EUR',
		completedAt,
	});
	const partial = build(expenses, members, '2026-09', [payment('2026-09-10T10:00:00Z', 400)]);
	assert.equal(partial.settled, false);
	assert.equal(partial.transfers[0]?.cents, 600);
	const paid = build(expenses, members, '2026-09', [payment('2026-10-10T10:00:00Z', 1000)]);
	assert.equal(paid.settled, true);
	assert.deepEqual(paid.transfers, []);
});

test('a payment in another currency does not pay off EUR shares', () => {
	const statement = build(
		[expense('a', 'L', '2026-09-02T10:00:00Z', { L: 1000, J: 1000 })],
		members,
		'2026-09',
		[
			{
				fromMemberId: 'J',
				toMemberId: 'L',
				amountCents: 1000,
				currency: 'USD',
				completedAt: '2026-09-10T10:00:00Z',
			},
		],
	);
	assert.equal(statement.settled, false);
	assert.deepEqual(
		statement.open.map((row) => `${row.currency}:${row.memberId}:${row.cents}`),
		['EUR:J:-1000', 'EUR:L:1000', 'USD:J:1000', 'USD:L:-1000'],
	);
});

test('opposite debts that cancel out leave nothing open', () => {
	const statement = build(
		[
			expense('a', 'L', '2026-09-02T10:00:00Z', { L: 0, J: 1000 }),
			expense('b', 'J', '2026-09-03T10:00:00Z', { J: 0, L: 1000 }),
		],
		members,
		'2026-09',
	);
	assert.deepEqual(statement.open, []);
	assert.deepEqual(statement.transfers, []);
	assert.equal(statement.settled, true);
});

test('category shares round to the nearest whole percent', () => {
	const statement = build(
		[
			{ ...expense('a', 'L', '2026-09-02T10:00:00Z', { J: 1000 }), category: 'groceries' },
			{ ...expense('b', 'L', '2026-09-03T10:00:00Z', { J: 2000 }), category: 'household' },
		],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.categories.map(({ category, share }) => [category, share]),
		[
			['household', 67],
			['groceries', 33],
		],
	);
});
