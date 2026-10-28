import 'server-only';
import { z } from 'zod';
import {
	DEFAULT_EXPENSE_CATEGORY,
	EXPENSE_CATEGORIES,
} from '@/features/expenses/expense-categories';

/** Request-body schema: optional, defaults to `sonstiges`. */
export const expenseCategoryValueSchema = z.enum(EXPENSE_CATEGORIES);
/** For creates: a missing category is the default. Edits use the value schema, so they keep theirs. */
export const expenseCategorySchema = expenseCategoryValueSchema.default(DEFAULT_EXPENSE_CATEGORY);
