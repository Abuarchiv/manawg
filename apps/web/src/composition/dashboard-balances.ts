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

export interface PayerTotal {
	paidByMemberId: string;
	currency: string;
	totalCents: number;
}

export interface OpenDebtTotal extends PayerTotal {
	debtorMemberId: string;
}

/**
 * The totals the dashboard reads from SQL, built from rows: the reference for the aggregation
 * (`dashboard-queries.ts`) and the input for tests that reason in single expenses.
 */
export function balanceTotalsFromRows(
	expenses: ReadonlyArray<{
		id: string;
		paidByMemberId: string;
		amountCents: number;
		currency?: string;
	}>,
	splits: ReadonlyArray<{
		expenseId: string;
		debtorMemberId: string;
		amountCents: number;
		settledAt: Date | null;
	}>,
): { payerTotals: PayerTotal[]; openDebts: OpenDebtTotal[] } {
	const payer = new Map<string, PayerTotal>();
	for (const expense of expenses) {
		const currency = normalizeCurrency(expense.currency);
		const key = `${currency}:${expense.paidByMemberId}`;
		const entry = payer.get(key) ?? {
			paidByMemberId: expense.paidByMemberId,
			currency,
			totalCents: 0,
		};
		entry.totalCents += expense.amountCents;
		payer.set(key, entry);
	}
	const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
	const debts = new Map<string, OpenDebtTotal>();
	for (const split of splits) {
		if (split.settledAt !== null) continue;
		const expense = expenseById.get(split.expenseId);
		if (!expense) continue;
		const currency = normalizeCurrency(expense.currency);
		const key = `${currency}:${expense.paidByMemberId}:${split.debtorMemberId}`;
		const entry = debts.get(key) ?? {
			paidByMemberId: expense.paidByMemberId,
			debtorMemberId: split.debtorMemberId,
			currency,
			totalCents: 0,
		};
		entry.totalCents += split.amountCents;
		debts.set(key, entry);
	}
	return { payerTotals: [...payer.values()], openDebts: [...debts.values()] };
}

/**
 * Balances from SQL totals: `payerTotals` sums every expense per payer and currency, `openDebts`
 * sums the unsettled splits per (payer, debtor, currency). Net balances use the open debts between
 * different roster members plus completed payments; gross paid/owed keep the payer's own share.
 */
export function computeMemberBalances(
	members: Array<{ id: string; name: string; color: string | null }>,
	payerTotals: readonly PayerTotal[],
	openDebts: readonly OpenDebtTotal[],
	payments: ExpensePaymentInput[] = [],
): MemberBalance[] {
	const netBalances = computeNetBalances(
		openDebts.map((debt) => ({
			paidByMemberId: debt.paidByMemberId,
			currency: normalizeCurrency(debt.currency),
			splits: [
				{ debtorMemberId: debt.debtorMemberId, amountCents: debt.totalCents, settledAt: null },
			],
		})),
		members,
		payments,
	);
	const grossByKey = new Map<string, { paidCents: number; owedCents: number }>();
	const gross = (key: string) => {
		const entry = grossByKey.get(key) ?? { paidCents: 0, owedCents: 0 };
		grossByKey.set(key, entry);
		return entry;
	};
	const currencies = new Set<string>(netBalances.map((balance) => balance.currency));
	for (const total of payerTotals) {
		const currency = normalizeCurrency(total.currency);
		currencies.add(currency);
		gross(`${currency}:${total.paidByMemberId}`).paidCents += total.totalCents;
	}
	for (const debt of openDebts) {
		gross(`${normalizeCurrency(debt.currency)}:${debt.debtorMemberId}`).owedCents +=
			debt.totalCents;
	}
	for (const payment of payments) {
		const currency = payment.currency?.trim().toUpperCase() || 'EUR';
		currencies.add(currency);
		gross(`${currency}:${payment.fromMemberId}`).paidCents += payment.amountCents;
		gross(`${currency}:${payment.toMemberId}`).owedCents += payment.amountCents;
	}

	return [...currencies].sort().flatMap((currency) =>
		members.map((member) => {
			const net = netBalances.find(
				(balance) => balance.memberId === member.id && balance.currency === currency,
			);
			const entry = grossByKey.get(`${currency}:${member.id}`);
			return {
				memberId: member.id,
				memberName: member.name,
				color: member.color,
				currency,
				paidCents: entry?.paidCents ?? 0,
				owedCents: entry?.owedCents ?? 0,
				balanceCents: net?.cents ?? 0,
			};
		}),
	);
}
