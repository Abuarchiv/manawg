import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';

export type ExpenseScope = 'all' | 'paid' | 'involved';

/** Narrows the loaded history by the member's role: `paid` = they paid, `involved` = they paid or carry a share. */
export function filterExpenses(
	expenses: readonly Expense[],
	scope: ExpenseScope,
	memberId: string,
): Expense[] {
	if (scope === 'all') return [...expenses];
	return expenses.filter((expense) => {
		const paid = expense.paidByMemberId === memberId;
		if (scope === 'paid') return paid;
		return paid || expense.splits.some((split) => split.debtorMemberId === memberId);
	});
}
