export const EXPENSE_CATEGORIES = [
	'groceries',
	'household',
	'housing',
	'leisure',
	'transport',
	'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'other';
