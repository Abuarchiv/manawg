import type { ExpenseCategory } from '@/features/expenses/expense-categories';
import type { Message } from '@/shared/i18n/message';

/** One debtor's share of an amount, as sent to and returned by the API. */
export type ExpenseSplitShare = { debtorMemberId: string; amountCents: number };

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
	/** Original cadence anchor; absent on pending offline rows. */
	anchorAt?: string;
	/** Paused templates are neither booked by the cron nor captured manually (API: abo_paused). */
	pausedAt: string | null;
	splits: ExpenseSplitShare[];
}

export type RecurringSplit = ExpenseSplitShare;

export type RecurringFilter = 'active' | 'paused' | 'all';

export interface MemberOption {
	id: string;
	name: string;
	color: string | null;
	active: boolean;
}

export type ExpenseFormField = 'description' | 'amount' | 'date' | 'splits';
export type ExpenseFormFieldErrors = Partial<Record<ExpenseFormField, Message>>;

export interface ReminderHistoryItem {
	id: string;
	debtorMemberId: string;
	creditorMemberId: string;
	amountCents: number;
	currency: string;
	channel: string;
	sentAt: string;
	oldestDebtAgeDays: number;
}
