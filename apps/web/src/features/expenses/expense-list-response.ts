import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import type { Expense } from '@/features/expenses/expense-types';

/** The expenses endpoint's response: the list plus the settlement payments it was read with. */
export interface ExpensesResponse {
	expenses: Expense[];
	payments?: ExpensePaymentInput[];
}

/** Rebuilds the cached expenses response around a changed list; payments stay as fetched. */
export function assembleExpensesResponse(
	items: Expense[],
	current: ExpensesResponse | undefined,
): ExpensesResponse {
	return { ...current, expenses: items, payments: current?.payments ?? [] };
}
