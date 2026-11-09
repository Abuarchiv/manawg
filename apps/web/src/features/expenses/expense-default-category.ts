import {
	DEFAULT_EXPENSE_CATEGORY,
	EXPENSE_CATEGORIES,
	type ExpenseCategory,
} from '@/features/expenses/expense-categories';

interface CategorySource {
	description: string;
	category: ExpenseCategory;
	paidByMemberId: string;
}

/** Narrows untrusted storage to a known category code. */
export function parseExpenseCategory(value: unknown): ExpenseCategory | null {
	return EXPENSE_CATEGORIES.find((code) => code === value) ?? null;
}

/**
 * The category a new expense starts with: the one of the member's latest expense with the same
 * description (case-insensitive, trimmed), else the last category used in this flat, else "other".
 * `expenses` is the loaded list, newest first.
 */
export function resolveDefaultCategory(input: {
	description: string;
	expenses: readonly CategorySource[];
	memberId: string;
	lastCategory: ExpenseCategory | null;
}): ExpenseCategory {
	const wanted = input.description.trim().toLowerCase();
	if (wanted) {
		const match = input.expenses.find(
			(expense) =>
				expense.paidByMemberId === input.memberId &&
				expense.description.trim().toLowerCase() === wanted,
		);
		if (match) return match.category;
	}
	return input.lastCategory ?? DEFAULT_EXPENSE_CATEGORY;
}
