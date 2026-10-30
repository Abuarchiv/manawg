export const EXPENSE_CATEGORIES = [
	'groceries',
	'household',
	'housing',
	'leisure',
	'transport',
	'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Plain German names for server output (exports, statements); screens render `expenseCategoryMessage`. */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
	groceries: 'Lebensmittel',
	// i18n-ignore German name for server output
	household: 'Haushalt',
	// i18n-ignore German name for server output
	housing: 'Wohnen & Nebenkosten',
	leisure: 'Freizeit',
	// i18n-ignore German name for server output
	transport: 'Mobilität',
	// i18n-ignore German name for server output
	other: 'Sonstiges',
};

export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'other';
