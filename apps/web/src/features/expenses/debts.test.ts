import { describe, expect, it } from 'vitest';
import {
	type DebtExpenseInput,
	computeBalances,
	computeOldestDebtAgeDays,
	findPairBalance,
} from './debts';

const T0 = '2026-05-01T08:00:00.000Z';
const T1 = '2026-05-10T08:00:00.000Z';
const T2 = '2026-05-20T08:00:00.000Z';

describe('computeBalances', () => {
	it('aggregates open splits per debtor/creditor pair', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'alice',
				occurredAt: T0,
				splits: [
					{ debtorMemberId: 'ben', amountCents: 1000, settledAt: null },
					{ debtorMemberId: 'alice', amountCents: 1000, settledAt: null },
				],
			},
			{
				paidByMemberId: 'alice',
				occurredAt: T1,
				splits: [{ debtorMemberId: 'ben', amountCents: 500, settledAt: null }],
			},
		];

		const balances = computeBalances(expenses);
		expect(balances).toEqual([{ creditorId: 'alice', debtorId: 'ben', amountCents: 1500 }]);
	});

	it('ignores settled splits and the payer own share', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'alice',
				occurredAt: T0,
				splits: [
					{ debtorMemberId: 'alice', amountCents: 700, settledAt: null },
					{ debtorMemberId: 'ben', amountCents: 700, settledAt: '2026-05-15T00:00:00.000Z' },
					{ debtorMemberId: 'cora', amountCents: 700, settledAt: null },
				],
			},
		];
		expect(computeBalances(expenses)).toEqual([
			{ creditorId: 'alice', debtorId: 'cora', amountCents: 700 },
		]);
	});

	it('returns empty when there is nothing open', () => {
		expect(computeBalances([])).toEqual([]);
	});

	it('drops pairs that net to zero by treating only positive splits', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'alice',
				occurredAt: T0,
				splits: [{ debtorMemberId: 'ben', amountCents: 0, settledAt: null }],
			},
		];
		expect(computeBalances(expenses)).toEqual([]);
	});
});

describe('computeOldestDebtAgeDays', () => {
	it('returns the age (days) of the oldest open split between debtor and creditor', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'alice',
				occurredAt: T0,
				splits: [{ debtorMemberId: 'ben', amountCents: 500, settledAt: null }],
			},
			{
				paidByMemberId: 'alice',
				occurredAt: T2,
				splits: [{ debtorMemberId: 'ben', amountCents: 200, settledAt: null }],
			},
		];

		const now = new Date('2026-05-25T08:00:00.000Z');
		expect(computeOldestDebtAgeDays('ben', 'alice', expenses, now)).toBe(24);
	});

	it('ignores expenses paid by someone other than the creditor', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'cora',
				occurredAt: T0,
				splits: [{ debtorMemberId: 'ben', amountCents: 500, settledAt: null }],
			},
		];
		const now = new Date('2026-05-25T08:00:00.000Z');
		expect(computeOldestDebtAgeDays('ben', 'alice', expenses, now)).toBe(0);
	});

	it('returns 0 when nothing is open between the pair', () => {
		const expenses: DebtExpenseInput[] = [
			{
				paidByMemberId: 'alice',
				occurredAt: T0,
				splits: [{ debtorMemberId: 'ben', amountCents: 500, settledAt: T1 }],
			},
		];
		const now = new Date('2026-05-25T08:00:00.000Z');
		expect(computeOldestDebtAgeDays('ben', 'alice', expenses, now)).toBe(0);
	});
});

describe('findPairBalance', () => {
	it('locates a specific pair', () => {
		const balances = [
			{ creditorId: 'alice', debtorId: 'ben', amountCents: 1500 },
			{ creditorId: 'cora', debtorId: 'ben', amountCents: 300 },
		];
		expect(findPairBalance(balances, 'ben', 'alice')).toEqual({
			creditorId: 'alice',
			debtorId: 'ben',
			amountCents: 1500,
		});
	});

	it('returns null when the pair has no open debt', () => {
		expect(findPairBalance([], 'ben', 'alice')).toBeNull();
	});
});
