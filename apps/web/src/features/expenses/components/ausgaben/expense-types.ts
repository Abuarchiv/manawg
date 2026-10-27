import type { ExpenseCategory } from '@/features/expenses/expense-categories';

export interface ExpenseSplit {
	id: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: string | null;
}

export interface Expense {
	id: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	category: ExpenseCategory;
	imageUrl: string | null;
	occurredAt: string;
	createdAt: string;
	updatedAt: string;
	splits: ExpenseSplit[];
}

export interface RecurringExpense {
	id: string;
	description: string;
	category: ExpenseCategory;
	amountCents: number;
	currency: string;
	paidByMemberId: string;
	intervalMonths: number;
	nextDueAt: string;
	createdByMemberId?: string;
	lastCreatedAt: string | null;
	/** Row version for the optimistic edit check; absent on pending offline rows. */
	updatedAt?: string;
	/** Paused templates are neither booked by the cron nor captured manually (API: abo_paused). */
	pausedAt?: string | null;
	splits: Array<{ debtorMemberId: string; amountCents: number }>;
}
