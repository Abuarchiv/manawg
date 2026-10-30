import 'server-only';
import { enumWithRenames } from '@/core/validators/renamed-value';
import {
	DEFAULT_EXPENSE_CATEGORY,
	EXPENSE_CATEGORIES,
} from '@/features/expenses/expense-categories';

/** Request-body schema: optional, defaults to `other`. */
export const expenseCategoryValueSchema = enumWithRenames(EXPENSE_CATEGORIES, {
	lebensmittel: 'groceries',
	haushalt: 'household',
	wohnen: 'housing',
	freizeit: 'leisure',
	mobilitaet: 'transport',
	sonstiges: 'other',
});
/** For creates: a missing category is the default. Edits use the value schema, so they keep theirs. */
export const expenseCategorySchema = expenseCategoryValueSchema.default(DEFAULT_EXPENSE_CATEGORY);
