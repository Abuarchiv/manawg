import { expect, test } from '@playwright/test';
import { computeMemberBalances } from '../src/core/reads/dashboard-data';
import { computeNetBalances } from '../src/features/expenses/debt-reduction';

const memberA = '11111111-1111-4111-8111-111111111111';
const memberB = '22222222-2222-4222-8222-222222222222';
const memberC = '33333333-3333-4333-8333-333333333333';

const members = [
	{ id: memberA, name: 'Anna', color: null },
	{ id: memberB, name: 'Ben', color: null },
	{ id: memberC, name: 'Cem', color: null },
];

type DashboardExpense = {
	id: string;
	paidByMemberId: string;
	amountCents: number;
};

type DashboardSplit = {
	expenseId: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: Date | null;
};

type Payment = {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
};

function expense(id: string, paidByMemberId: string, amountCents = 3_000): DashboardExpense {
	return { id, paidByMemberId, amountCents };
}

function split(
	expenseId: string,
	debtorMemberId: string,
	amountCents: number,
	settledAt: Date | null = null,
): DashboardSplit {
	return { expenseId, debtorMemberId, amountCents, settledAt };
}

function canonicalBalances(
	expenses: DashboardExpense[],
	splits: DashboardSplit[],
	payments: Payment[] = [],
) {
	const grouped = new Map<string, DashboardSplit[]>();
	for (const current of splits) {
		const group = grouped.get(current.expenseId) ?? [];
		group.push(current);
		grouped.set(current.expenseId, group);
	}

	return computeNetBalances(
		expenses.map((current) => ({
			paidByMemberId: current.paidByMemberId,
			splits: (grouped.get(current.id) ?? []).map((currentSplit) => ({
				debtorMemberId: currentSplit.debtorMemberId,
				amountCents: currentSplit.amountCents,
				settledAt: currentSplit.settledAt?.toISOString() ?? null,
			})),
		})),
		members,
		payments,
	);
}

function dashboardBalances(
	expenses: DashboardExpense[],
	splits: DashboardSplit[],
	payments: Payment[] = [],
) {
	return computeMemberBalances(members, expenses, splits, payments);
}

function expectCanonicalBalance(
	expenses: DashboardExpense[],
	splits: DashboardSplit[],
	payments: Payment[] = [],
) {
	const actual = dashboardBalances(expenses, splits, payments);
	const expected = canonicalBalances(expenses, splits, payments);
	for (const member of expected) {
		const row = actual.find((current) => current.memberId === member.memberId);
		expect(row).toMatchObject({
			memberId: member.memberId,
			memberName: member.memberName,
			color: member.color,
			paidCents: expect.any(Number),
			owedCents: expect.any(Number),
			balanceCents: member.cents,
		});
	}
	return actual;
}

test.describe('Dashboard balance consistency', () => {
	test('matches canonical balances for an unsettled three-person expense', () => {
		const currentExpense = expense('expense-unpaid', memberA);
		const actual = expectCanonicalBalance(
			[currentExpense],
			[
				split(currentExpense.id, memberA, 1_000),
				split(currentExpense.id, memberB, 1_000),
				split(currentExpense.id, memberC, 1_000),
			],
		);

		expect(actual.map((row) => row.balanceCents)).toEqual([2_000, -1_000, -1_000]);
	});

	test('matches canonical balances for partial and full settlement', () => {
		const currentExpense = expense('expense-settlement', memberA);
		const splits = [
			split(currentExpense.id, memberA, 1_000),
			split(currentExpense.id, memberB, 1_000),
			split(currentExpense.id, memberC, 1_000),
		];

		const partialSplits = [splits[0], { ...splits[1], settledAt: new Date() }, splits[2]];
		expect(
			expectCanonicalBalance([currentExpense], partialSplits).map((row) => row.balanceCents),
		).toEqual([1_000, 0, -1_000]);
		expectCanonicalBalance(
			[currentExpense],
			splits.map((current) => ({ ...current, settledAt: new Date() })),
		);
		expect(
			dashboardBalances(
				[currentExpense],
				splits.map((current) => ({ ...current, settledAt: new Date() })),
			).map((row) => row.balanceCents),
		).toEqual([0, 0, 0]);
	});

	test('keeps own shares neutral and applies completed provider transfers', () => {
		const ownExpense = expense('expense-own', memberA);
		expectCanonicalBalance([ownExpense], [split(ownExpense.id, memberA, 3_000)]);
		expect(
			dashboardBalances([ownExpense], [split(ownExpense.id, memberA, 3_000)]).map(
				(row) => row.balanceCents,
			),
		).toEqual([0, 0, 0]);

		const sharedExpense = expense('expense-paid', memberA);
		expect(
			expectCanonicalBalance(
				[sharedExpense],
				[
					split(sharedExpense.id, memberA, 1_000),
					split(sharedExpense.id, memberB, 1_000),
					split(sharedExpense.id, memberC, 1_000),
				],
				[{ fromMemberId: memberB, toMemberId: memberA, amountCents: 1_000, currency: 'EUR' }],
			).map((row) => row.balanceCents),
		).toEqual([1_000, 0, -1_000]);
	});
});
