import { EXPENSE_CATEGORY_LABELS } from '@/features/expenses/expense-categories';
import type { Expense } from '@/features/expenses/expense-types';

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

function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Free-text search over what a row shows: description, category and who paid. Every word must match. */
export function matchesExpenseQuery(
	expense: Expense,
	query: string,
	payerName: (memberId: string) => string,
): boolean {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const haystack = fold(
		`${expense.description} ${EXPENSE_CATEGORY_LABELS[expense.category]} ${payerName(expense.paidByMemberId)}`,
	);
	return words.every((word) => haystack.includes(word));
}
