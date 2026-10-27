import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
	'lebensmittel',
	'haushalt',
	'wohnen',
	'freizeit',
	'mobilitaet',
	'sonstiges',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
	lebensmittel: 'Lebensmittel',
	haushalt: 'Haushalt',
	wohnen: 'Wohnen & Nebenkosten',
	freizeit: 'Freizeit',
	mobilitaet: 'Mobilität',
	sonstiges: 'Sonstiges',
};

export const DEFAULT_EXPENSE_CATEGORY: ExpenseCategory = 'sonstiges';

/** Request-body schema: optional, defaults to `sonstiges`. */
export const expenseCategoryValueSchema = z.enum(EXPENSE_CATEGORIES);
/** For creates: a missing category is the default. Edits use the value schema, so they keep theirs. */
export const expenseCategorySchema = expenseCategoryValueSchema.default(DEFAULT_EXPENSE_CATEGORY);

/** Label for a stored value; anything unknown reads as the default label. */
export function expenseCategoryLabel(value: string | null | undefined): string {
	return (
		EXPENSE_CATEGORY_LABELS[(value ?? '') as ExpenseCategory] ?? EXPENSE_CATEGORY_LABELS.sonstiges
	);
}
