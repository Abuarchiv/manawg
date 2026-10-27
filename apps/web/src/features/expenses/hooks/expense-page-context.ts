import type { useToast } from '@/components/ui/Toast';
import type { Member, WgSummary } from '@/components/wg/WgContextProvider';
import type { SessionMember } from '@/core/auth/local-account';
import type { Expense, RecurringExpense } from '@/features/expenses/expense-types';
import type { useExpenseForm } from '@/features/expenses/hooks/use-expense-form';

export interface ActionNotifier {
	error: (message: string | null) => void;
	warning: (message: string) => void;
	success: (message: string) => void;
}

interface PendingIds {
	isPending: (id: string) => boolean;
	start: (id: string) => void;
	end: (id: string) => void;
}

/** What the Ausgaben mutation hooks share: who acts, where results go, how to reload. */
export interface ExpensePageContext {
	wg: Pick<WgSummary, 'id' | 'shareCode'>;
	identity: SessionMember;
	members: Member[];
	toast: ReturnType<typeof useToast>;
	notify: ActionNotifier;
	pending: PendingIds;
	expenses: Expense[];
	recurringExpenses: RecurringExpense[];
	updateExpenses: (update: (current: Expense[]) => Expense[]) => void;
	updateRecurringExpenses: (update: (current: RecurringExpense[]) => RecurringExpense[]) => void;
	reload: () => Promise<void>;
	refreshQueuedCount: () => void;
}

export type ExpenseFormState = ReturnType<typeof useExpenseForm>;
