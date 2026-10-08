import { normalizeCurrency } from '@/core/utils/money';
import { computeNetBalances } from '@/features/expenses/debt-reduction';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';

export interface MemberBalance {
	memberId: string;
	memberName: string;
	color: string | null;
	currency: string;
	paidCents: number;
	owedCents: number;
	balanceCents: number;
}

export function computeMemberBalances(
	members: Array<{ id: string; name: string; color: string | null }>,
	expenses: Array<{
		id: string;
		paidByMemberId: string;
		amountCents: number;
		currency?: string;
	}>,
	splits: Array<{
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	}>,
	payments: ExpensePaymentInput[] = [],
): MemberBalance[] {
	const splitsByExpense = new Map<
		string,
		Array<{ debtorMemberId: string; amountCents: number; settledAt: string | null }>
	>();
	for (const split of splits) {
		const expenseSplits = splitsByExpense.get(split.expenseId) ?? [];
		expenseSplits.push({
			debtorMemberId: split.debtorMemberId,
			amountCents: split.amountCents,
			settledAt: split.settledAt?.toISOString() ?? null,
		});
		splitsByExpense.set(split.expenseId, expenseSplits);
	}

	const normalizedExpenses = expenses.map((expense) => ({
		...expense,
		currency: normalizeCurrency(expense.currency),
	}));
	const netBalances = computeNetBalances(
		normalizedExpenses.map((expense) => ({
			paidByMemberId: expense.paidByMemberId,
			currency: expense.currency,
			splits: splitsByExpense.get(expense.id) ?? [],
		})),
		members,
		payments,
	);
	const grossByKey = new Map<string, { paidCents: number; owedCents: number }>();
	const currencies = new Set<string>(netBalances.map((balance) => balance.currency));
	for (const expense of normalizedExpenses) {
		currencies.add(expense.currency);
		const key = `${expense.currency}:${expense.paidByMemberId}`;
		const paid = grossByKey.get(key) ?? { paidCents: 0, owedCents: 0 };
		paid.paidCents += expense.amountCents;
		grossByKey.set(key, paid);
	}
	const currencyByExpenseId = new Map(
		normalizedExpenses.map((expense) => [expense.id, expense.currency]),
	);
	for (const split of splits) {
		if (split.settledAt) continue;
		const currency = currencyByExpenseId.get(split.expenseId) ?? 'EUR';
		const key = `${currency}:${split.debtorMemberId}`;
		const owed = grossByKey.get(key) ?? { paidCents: 0, owedCents: 0 };
		owed.owedCents += split.amountCents;
		grossByKey.set(key, owed);
	}
	for (const payment of payments) {
		const currency = payment.currency?.trim().toUpperCase() || 'EUR';
		currencies.add(currency);
		const paidKey = `${currency}:${payment.fromMemberId}`;
		const owedKey = `${currency}:${payment.toMemberId}`;
		const paid = grossByKey.get(paidKey) ?? { paidCents: 0, owedCents: 0 };
		const owed = grossByKey.get(owedKey) ?? { paidCents: 0, owedCents: 0 };
		paid.paidCents += payment.amountCents;
		owed.owedCents += payment.amountCents;
		grossByKey.set(paidKey, paid);
		grossByKey.set(owedKey, owed);
	}

	return [...currencies].sort().flatMap((currency) =>
		members.map((member) => {
			const net = netBalances.find(
				(balance) => balance.memberId === member.id && balance.currency === currency,
			);
			const gross = grossByKey.get(`${currency}:${member.id}`);
			return {
				memberId: member.id,
				memberName: member.name,
				color: member.color,
				currency,
				paidCents: gross?.paidCents ?? 0,
				owedCents: gross?.owedCents ?? 0,
				balanceCents: net?.cents ?? 0,
			};
		}),
	);
}
