import { berlinDayKey } from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';
import { type SimplifiedDebt, simplifyDebts } from './debt-reduction';
import {
	EXPENSE_CATEGORIES,
	EXPENSE_CATEGORY_LABELS,
	type ExpenseCategory,
} from './expense-categories';
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
	balanceCents: number;
}

interface StatementItem {
	id: string;
	occurredAt: string;
	description: string;
	payerName: string;
	amountCents: number;
}

interface StatementCategory {
	category: ExpenseCategory;
	label: string;
	cents: number;
	/** Share of the month total, whole percent. */
	share: number;
}

export interface MonthlyStatement {
	monthKey: string;
	totalCents: number;
	items: StatementItem[];
	/** Spending per category, largest first; the catch-all category always last. */
	categories: StatementCategory[];
	members: StatementMemberRow[];
	transfers: SimplifiedDebt[];
	/** Every share owed to someone else in this month is settled. */
	settled: boolean;
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
		const category = EXPENSE_CATEGORIES.find((code) => code === expense.category) ?? 'sonstiges';
		sums.set(category, (sums.get(category) ?? 0) + expense.amountCents);
	}
	return [...sums]
		.map(([category, cents]) => ({
			category,
			label: EXPENSE_CATEGORY_LABELS[category],
			cents,
			share: totalCents > 0 ? Math.round((cents / totalCents) * 100) : 0,
		}))
		.sort((a, b) => {
			if (a.category === 'sonstiges' || b.category === 'sonstiges') {
				return a.category === 'sonstiges' ? 1 : -1;
			}
			return b.cents - a.cents;
		});
}

/**
 * One month of a WG's expenses: what each member paid, their share, the
 * month balance (what is still open: paid minus share, minus shares marked
 * settled and payments) and the fewest transfers that clear it. Paid and
 * share count settled shares too, so a paid-off month still shows who
 * carried what. Payments (PayPal, cash) never set
 * `settledAt`; each pays off the open shares of its debtor/payer pair oldest
 * first, whenever it was made, so a later payment settles an earlier month
 * and never turns into a reverse debt. Pass all expenses and payments of the
 * WG, not only the month's. Only EUR expenses and payments are counted.
 */
export function buildMonthlyStatement(
	expenses: readonly StatementExpense[],
	members: readonly StatementMemberInput[],
	monthKey: string,
	payments: readonly ExpensePaymentInput[] = [],
): MonthlyStatement {
	const eur = expenses
		.filter((expense) => normalizeCurrency(expense.currency) === 'EUR')
		.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
	const inMonth = eur.filter(
		(expense) => berlinMonthKey(new Date(expense.occurredAt)) === monthKey,
	);

	const paid = new Map<string, number>();
	const share = new Map<string, number>();
	const adjustment = new Map<string, number>();
	for (const expense of inMonth) {
		paid.set(expense.paidByMemberId, (paid.get(expense.paidByMemberId) ?? 0) + expense.amountCents);
		for (const split of expense.splits) {
			share.set(split.debtorMemberId, (share.get(split.debtorMemberId) ?? 0) + split.amountCents);
		}
	}
	// Payment total per `debtor>payer` pair, spent on that pair's open shares oldest first.
	const paymentPool = new Map<string, number>();
	for (const payment of payments) {
		if (
			payment.amountCents <= 0 ||
			normalizeCurrency(payment.currency) !== 'EUR' ||
			!payment.completedAt
		) {
			continue;
		}
		const pair = `${payment.fromMemberId}>${payment.toMemberId}`;
		paymentPool.set(pair, (paymentPool.get(pair) ?? 0) + payment.amountCents);
	}
	// Open amount of this month per pair after settled shares and payments.
	const openByPair = new Map<string, number>();
	for (const expense of eur) {
		const isInMonth = berlinMonthKey(new Date(expense.occurredAt)) === monthKey;
		for (const split of expense.splits) {
			const { debtorMemberId: from } = split;
			const to = expense.paidByMemberId;
			if (from === to || split.amountCents <= 0) continue;
			const pair = `${from}>${to}`;
			let covered = split.amountCents;
			if (split.settledAt === null) {
				covered = Math.min(paymentPool.get(pair) ?? 0, split.amountCents);
				paymentPool.set(pair, (paymentPool.get(pair) ?? 0) - covered);
			}
			if (!isInMonth) continue;
			openByPair.set(pair, (openByPair.get(pair) ?? 0) + split.amountCents - covered);
			adjustment.set(from, (adjustment.get(from) ?? 0) + covered);
			adjustment.set(to, (adjustment.get(to) ?? 0) - covered);
		}
	}
	const settled = [...openByPair.values()].every((cents) => cents <= 0);

	const nameOf = (id: string) =>
		members.find((member) => member.id === id)?.name ?? 'Ehemaliges Mitglied';
	// Active members always appear; former members only when they took part this month.
	const rows = members
		.filter((member) => member.active || paid.has(member.id) || share.has(member.id))
		.map((member) => {
			const paidCents = paid.get(member.id) ?? 0;
			const shareCents = share.get(member.id) ?? 0;
			return {
				id: member.id,
				name: member.name,
				paidCents,
				shareCents,
				balanceCents: paidCents - shareCents + (adjustment.get(member.id) ?? 0),
			};
		});

	const transfers = simplifyDebts(
		rows.map((row) => ({
			memberId: row.id,
			memberName: row.name,
			color: null,
			cents: row.balanceCents,
			currency: 'EUR',
		})),
	);

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
		transfers,
		settled,
	};
}
