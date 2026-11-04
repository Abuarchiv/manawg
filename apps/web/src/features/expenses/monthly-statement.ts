import { berlinDayKey } from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';
import { computeNetBalances, type SimplifiedDebt, simplifyDebts } from './debt-reduction';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from './expense-categories';
import type { ExpensePaymentInput } from './expense-payment-input';

export interface StatementExpense {
	id: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	category?: string;
	occurredAt: string;
	splits: Array<{ debtorMemberId: string; amountCents: number; settledAt: string | null }>;
}

export interface StatementMemberInput {
	id: string;
	name: string;
	active: boolean;
}

interface StatementMemberRow {
	id: string;
	name: string;
	paidCents: number;
	shareCents: number;
}

interface StatementItem {
	id: string;
	occurredAt: string;
	description: string;
	/** Null when the payer is not in the members list; the renderer shows a localized label. */
	payerName: string | null;
	amountCents: number;
}

interface StatementCategory {
	category: ExpenseCategory;
	cents: number;
	/** Share of the month total, whole percent. */
	share: number;
}

/** What a member still owes (negative) or gets (positive) in one currency; zero balances are left out. */
interface StatementOpenBalance {
	memberId: string;
	name: string;
	currency: string;
	cents: number;
}

export interface MonthlyStatement {
	monthKey: string;
	totalCents: number;
	items: StatementItem[];
	/** Spending per category, largest first; the catch-all category always last. */
	categories: StatementCategory[];
	/** What each member paid and owed in the month (EUR). */
	members: StatementMemberRow[];
	/** Open balances as of `asOf`, EUR first, then by currency code and name. */
	open: StatementOpenBalance[];
	/** The transfers that settle every open balance, all currencies. */
	transfers: SimplifiedDebt[];
	/** No member has an open balance in any currency. */
	settled: boolean;
	/** ISO instant the open balances are as of. */
	asOf: string;
}

/** Berlin calendar month (YYYY-MM) of an instant. */
export function berlinMonthKey(date: Date): string {
	return berlinDayKey(date).slice(0, 7);
}

/** YYYY-MM shifted by whole months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
	const [year, month] = monthKey.split('-').map(Number);
	const index = (year ?? 0) * 12 + (month ?? 1) - 1 + delta;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Sums per category, descending; the catch-all category goes last whatever its size. */
function buildCategories(
	expenses: readonly StatementExpense[],
	totalCents: number,
): StatementCategory[] {
	const sums = new Map<ExpenseCategory, number>();
	for (const expense of expenses) {
		const category = EXPENSE_CATEGORIES.find((code) => code === expense.category) ?? 'other';
		sums.set(category, (sums.get(category) ?? 0) + expense.amountCents);
	}
	return [...sums]
		.map(([category, cents]) => ({
			category,
			cents,
			share: totalCents > 0 ? Math.round((cents / totalCents) * 100) : 0,
		}))
		.sort((a, b) => {
			if (a.category === 'other' || b.category === 'other') {
				return a.category === 'other' ? 1 : -1;
			}
			return b.cents - a.cents;
		});
}

/**
 * One month of a WG: totals, items, categories and what each member paid and
 * owed in that month (EUR), plus what each member still owes or gets as of
 * `asOf`. The open part uses the ledger maths of the expenses page over all
 * expenses and completed payments in every currency, so both show the same
 * numbers. Pass all expenses and payments of the WG, not only the month's.
 */
export function buildMonthlyStatement(
	expenses: readonly StatementExpense[],
	members: readonly StatementMemberInput[],
	monthKey: string,
	payments: readonly ExpensePaymentInput[],
	asOf: Date,
): MonthlyStatement {
	const inMonth = expenses
		.filter(
			(expense) =>
				normalizeCurrency(expense.currency) === 'EUR' &&
				berlinMonthKey(new Date(expense.occurredAt)) === monthKey,
		)
		.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

	const paid = new Map<string, number>();
	const share = new Map<string, number>();
	for (const expense of inMonth) {
		paid.set(expense.paidByMemberId, (paid.get(expense.paidByMemberId) ?? 0) + expense.amountCents);
		for (const split of expense.splits) {
			share.set(split.debtorMemberId, (share.get(split.debtorMemberId) ?? 0) + split.amountCents);
		}
	}

	const balances = computeNetBalances(
		[...expenses],
		members.map((member) => ({ id: member.id, name: member.name, color: null })),
		payments,
	);
	const open = balances
		.filter((balance) => balance.cents !== 0)
		.map((balance) => ({
			memberId: balance.memberId,
			name: balance.memberName,
			currency: balance.currency,
			cents: balance.cents,
		}))
		.sort(
			(a, b) =>
				Number(b.currency === 'EUR') - Number(a.currency === 'EUR') ||
				a.currency.localeCompare(b.currency) ||
				a.name.localeCompare(b.name),
		);

	// Active members always appear; former members when they took part this month or still hold a balance.
	const holders = new Set(open.map((row) => row.memberId));
	const rows = members
		.filter(
			(member) =>
				member.active || paid.has(member.id) || share.has(member.id) || holders.has(member.id),
		)
		.map((member) => ({
			id: member.id,
			name: member.name,
			paidCents: paid.get(member.id) ?? 0,
			shareCents: share.get(member.id) ?? 0,
		}));
	const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? null;

	const totalCents = inMonth.reduce((sum, expense) => sum + expense.amountCents, 0);
	return {
		monthKey,
		totalCents,
		categories: buildCategories(inMonth, totalCents),
		items: inMonth.map((expense) => ({
			id: expense.id,
			occurredAt: expense.occurredAt,
			description: expense.description,
			payerName: nameOf(expense.paidByMemberId),
			amountCents: expense.amountCents,
		})),
		members: rows,
		open,
		transfers: simplifyDebts(balances),
		settled: open.length === 0,
		asOf: asOf.toISOString(),
	};
}
