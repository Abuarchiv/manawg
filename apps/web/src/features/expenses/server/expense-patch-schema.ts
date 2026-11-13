import 'server-only';
import { z } from 'zod';
import { imageUrlSchema } from '@/core/validators/image-url';
import { MAX_SPLITS } from '../expense-constants';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
	occurredAtSchema,
} from '../expense-schemas';
import { expenseCategoryValueSchema } from './expense-category-schema';

export const patchSchema = z.object({
	description: expenseDescriptionSchema.optional(),
	category: expenseCategoryValueSchema.optional(),
	amountCents: expenseAmountSchema.optional(),
	imageUrl: imageUrlSchema,
	occurredAt: occurredAtSchema.optional(),
	expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS).optional(),
});
