import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { expenseCategorySchema, expenseCategoryValueSchema } from './expense-category-schema';

// zod 4 applies a default even inside .optional(); an edit without category must stay an
// edit without category, or an advance-only PATCH turns into an owner-only edit.
test('a missing category defaults on create but stays absent on edit', () => {
	assert.deepEqual(z.object({ category: expenseCategorySchema }).parse({}), {
		category: 'other',
	});
	assert.deepEqual(z.object({ category: expenseCategoryValueSchema.optional() }).parse({}), {});
});

test('German keys from older offline queues read as their English key', () => {
	assert.equal(expenseCategoryValueSchema.parse('lebensmittel'), 'groceries');
	assert.equal(expenseCategoryValueSchema.parse('groceries'), 'groceries');
	assert.equal(expenseCategoryValueSchema.safeParse('constructor').success, false);
});
