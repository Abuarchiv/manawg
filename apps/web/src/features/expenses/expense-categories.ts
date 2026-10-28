export const EXPENSE_CATEGORIES = [
	'lebensmittel',
	'haushalt',
	'wohnen',
	'freizeit',
	'mobilitaet',
	'sonstiges',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Plain German names for server output (exports, statements); screens render `expenseCategoryMessage`. */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
	lebensmittel: 'Lebensmittel',
	// i18n-ignore German name for server output
	haushalt: 'Haushalt',
	// i18n-ignore German name for server output
	wohnen: 'Wohnen & Nebenkosten',
	freizeit: 'Freizeit',
	// i18n-ignore German name for server output
	mobilitaet: 'Mobilität',
	// i18n-ignore German name for server output
	sonstiges: 'Sonstiges',
};

export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'sonstiges';

/** Label for a stored value; anything unknown reads as the default label. */
export function expenseCategoryLabel(value: string | null | undefined): string {
	return (
		EXPENSE_CATEGORY_LABELS[(value ?? '') as ExpenseCategory] ?? EXPENSE_CATEGORY_LABELS.sonstiges
	);
}
