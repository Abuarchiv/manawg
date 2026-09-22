import { expect, test } from '@playwright/test';
import { getDebtOverview } from '../src/features/expenses/debt-overview';
import {
	buildSettlementSummary,
	computeDirectDebts,
} from '../src/features/expenses/debt-reduction';

const outgoing = { fromId: 'me', fromName: 'Alex', toId: 'lisa', toName: 'Lisa', cents: 1200 };
const incoming = { fromId: 'lisa', fromName: 'Lisa', toId: 'me', toName: 'Alex', cents: 1200 };
const other = { fromId: 'ben', fromName: 'Ben', toId: 'sara', toName: 'Sara', cents: 2500 };

test('reciprocal open expenses cancel without resurfacing as transfer demands', () => {
	const members = [
		{ id: 'me', name: 'Alex', color: null },
		{ id: 'lisa', name: 'Lisa', color: null },
	];
	const expenses = [
		{
			paidByMemberId: 'me',
			splits: [{ debtorMemberId: 'lisa', amountCents: 1200, settledAt: null }],
		},
		{
			paidByMemberId: 'lisa',
			splits: [{ debtorMemberId: 'me', amountCents: 1200, settledAt: null }],
		},
	];
	const summary = buildSettlementSummary(expenses, members);
	expect(getDebtOverview(computeDirectDebts(expenses, members), 'me', summary)).toEqual({
		personal: [],
		others: [],
	});
	expect(expenses.every((expense) => expense.splits[0]?.settledAt === null)).toBe(true);
});

test('incoming and outgoing personal transfers are separated from other residents', () => {
	expect(getDebtOverview([other, outgoing, incoming], 'me')).toEqual({
		personal: [outgoing, incoming],
		others: [other],
	});
});

test('uninvolved residents have no personal demand', () => {
	expect(getDebtOverview([other], 'me')).toEqual({ personal: [], others: [other] });
});

test('a provided simplified result is authoritative even without direct debts', () => {
	expect(
		getDebtOverview([], 'me', {
			directCount: 0,
			simplifiedCount: 1,
			savedTransfers: 0,
			totalOpenCents: 1200,
			simplified: [outgoing],
		}).personal,
	).toEqual([outgoing]);
});
