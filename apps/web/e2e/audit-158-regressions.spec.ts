import { expect, test } from '@playwright/test';
import { computeMemberBalances } from '../src/core/reads/dashboard-data';
import { computeNetBalances } from '../src/features/expenses/debt-reduction';
import { computeBalances, computeOldestDebtAges } from '../src/features/expenses/debts';

const alice = '11111111-1111-4111-8111-111111111111';
const ben = '22222222-2222-4222-8222-222222222222';
const members = [
	{ id: alice, name: 'Alice', color: null },
	{ id: ben, name: 'Ben', color: null },
];

test.describe('audit #158 accounting invariants', () => {
	test('keeps balances and payments separate for each currency', () => {
		const expenses = [
			{
				paidByMemberId: alice,
				currency: 'EUR',
				occurredAt: '2026-01-01T12:00:00.000Z',
				splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: alice,
				currency: 'CHF',
				occurredAt: '2026-01-02T12:00:00.000Z',
				splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
			},
		];
		const payments = [{ fromMemberId: ben, toMemberId: alice, amountCents: 1000, currency: 'EUR' }];

		expect(computeBalances(expenses, payments)).toEqual([
			{ debtorId: ben, creditorId: alice, amountCents: 1000, currency: 'CHF' },
		]);
		expect(computeNetBalances(expenses, members, payments)).toEqual([
			{ memberId: alice, memberName: 'Alice', color: null, cents: 1000, currency: 'CHF' },
			{ memberId: ben, memberName: 'Ben', color: null, cents: -1000, currency: 'CHF' },
			{ memberId: alice, memberName: 'Alice', color: null, cents: 0, currency: 'EUR' },
			{ memberId: ben, memberName: 'Ben', color: null, cents: 0, currency: 'EUR' },
		]);
	});

	test('keeps dashboard gross balances in separate currency rows', () => {
		const expenses = [
			{ id: 'eur', paidByMemberId: alice, amountCents: 1000, currency: 'EUR' },
			{ id: 'chf', paidByMemberId: alice, amountCents: 1000, currency: 'CHF' },
		];
		const splits = [
			{ expenseId: 'eur', debtorMemberId: ben, amountCents: 1000, settledAt: null },
			{ expenseId: 'chf', debtorMemberId: ben, amountCents: 1000, settledAt: null },
		];

		expect(computeMemberBalances(members, expenses, splits)).toEqual([
			{
				memberId: alice,
				memberName: 'Alice',
				color: null,
				currency: 'CHF',
				paidCents: 1000,
				owedCents: 0,
				balanceCents: 1000,
			},
			{
				memberId: ben,
				memberName: 'Ben',
				color: null,
				currency: 'CHF',
				paidCents: 0,
				owedCents: 1000,
				balanceCents: -1000,
			},
			{
				memberId: alice,
				memberName: 'Alice',
				color: null,
				currency: 'EUR',
				paidCents: 1000,
				owedCents: 0,
				balanceCents: 1000,
			},
			{
				memberId: ben,
				memberName: 'Ben',
				color: null,
				currency: 'EUR',
				paidCents: 0,
				owedCents: 1000,
				balanceCents: -1000,
			},
		]);
	});

	test('matches reminder ages by currency as well as member pair', () => {
		const expenses = [
			{
				paidByMemberId: alice,
				currency: 'EUR',
				occurredAt: '2026-01-01T12:00:00.000Z',
				splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
			},
			{
				paidByMemberId: alice,
				currency: 'CHF',
				occurredAt: '2026-01-10T12:00:00.000Z',
				splits: [{ debtorMemberId: ben, amountCents: 1000, settledAt: null }],
			},
		];
		const now = new Date('2026-01-11T12:00:00.000Z');

		expect(
			computeOldestDebtAges(
				[
					{ debtorId: ben, creditorId: alice, currency: 'EUR' },
					{ debtorId: ben, creditorId: alice, currency: 'CHF' },
				],
				expenses,
				now,
			),
		).toEqual([10, 1]);
	});
});
