import { berlinDayKey } from '@/core/utils/berlin-day';
import { normalizeCurrency } from '@/core/utils/money';
import { type SimplifiedDebt, simplifyDebts } from './debt-reduction';
import {
	EXPENSE_CATEGORIES,
	EXPENSE_CATEGORY_LABELS,
	type ExpenseCategory,
} from './expense-categories';

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
 * month balance (paid minus share) and the fewest transfers that clear it.
 * Balances count settled shares too, so a paid-off month still shows who
 * carried what. Only EUR expenses are counted.
 */
export function buildMonthlyStatement(
	expenses: readonly StatementExpense[],
	members: readonly StatementMemberInput[],
	monthKey: string,
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
	let settled = true;
	for (const expense of inMonth) {
		paid.set(expense.paidByMemberId, (paid.get(expense.paidByMemberId) ?? 0) + expense.amountCents);
		for (const split of expense.splits) {
			share.set(split.debtorMemberId, (share.get(split.debtorMemberId) ?? 0) + split.amountCents);
			if (split.debtorMemberId !== expense.paidByMemberId && split.settledAt === null) {
				settled = false;
			}
		}
	}

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
				balanceCents: paidCents - shareCents,
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
