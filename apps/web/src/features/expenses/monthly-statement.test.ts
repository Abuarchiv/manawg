import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMonthlyStatement, shiftMonthKey } from './monthly-statement';

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
	const statement = buildMonthlyStatement(
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
		statement.members.map(({ id, paidCents, shareCents, balanceCents }) => [
			id,
			paidCents,
			shareCents,
			balanceCents,
		]),
		[
			['L', 2000, 1500, 500],
			['J', 1000, 1500, -500],
		],
	);
	assert.deepEqual(
		statement.transfers.map(({ fromId, toId, cents }) => [fromId, toId, cents]),
		[['J', 'L', 500]],
	);
	assert.equal(statement.settled, false);
});

test('categories are summed per month, largest first, "sonstiges" last', () => {
	const withCategory = (category: string | undefined, id: string, cents: number) => ({
		...expense(id, 'L', '2026-09-10T10:00:00Z', { L: cents }),
		...(category ? { category } : {}),
	});
	const statement = buildMonthlyStatement(
		[
			withCategory('sonstiges', 'a', 10000),
			withCategory('freizeit', 'b', 2000),
			withCategory('lebensmittel', 'c', 5000),
			withCategory('lebensmittel', 'd', 1000),
			// Missing or unknown categories count as "sonstiges".
			withCategory(undefined, 'e', 1000),
			withCategory('unbekannt', 'f', 1000),
		],
		members,
		'2026-09',
	);
	assert.deepEqual(
		statement.categories.map(({ category, cents, share }) => [category, cents, share]),
		[
			['lebensmittel', 6000, 30],
			['freizeit', 2000, 10],
			['sonstiges', 12000, 60],
		],
	);
	assert.equal(statement.categories[0]?.label, 'Lebensmittel');
});

test('month key arithmetic crosses years', () => {
	assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
	assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
});
