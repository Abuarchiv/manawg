import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecurringExpense } from './expense-types';

const { expenseFormModeKey, expenseFormTitle, expenseSubmitLabel } = await import(
	'./expense-form-mode'
);

const template = { id: 'r1' } as RecurringExpense;
const none = {
	editingRecurringExpense: null as RecurringExpense | null,
	isEditingQueuedRecurring: false,
	isEditingQueuedExpense: false,
	isEditingExpense: false,
};

test('the sheet title follows what the form edits, the template first', () => {
	const title = (over: Partial<typeof none>) => expenseFormTitle({ ...none, ...over }).key;
	assert.equal(title({}), 'expenses-form.title.add');
	assert.equal(title({ isEditingExpense: true }), 'expenses-form.title.edit');
	assert.equal(
		title({ isEditingQueuedExpense: true, isEditingExpense: true }),
		'expenses-form.title.editQueuedExpense',
	);
	assert.equal(
		title({ isEditingQueuedRecurring: true, isEditingQueuedExpense: true }),
		'expenses-form.title.editQueuedTemplate',
	);
	assert.equal(
		title({ editingRecurringExpense: template, isEditingQueuedRecurring: true }),
		'expenses-form.title.editTemplate',
	);
});

test('the draft key changes with the template or expense being edited', () => {
	const key = (over: Partial<Parameters<typeof expenseFormModeKey>[0]>) =>
		expenseFormModeKey({
			editingRecurringExpense: null,
			isEditingExpense: false,
			editingExpenseId: null,
			...over,
		});
	assert.equal(key({}), 'new');
	assert.equal(key({ isEditingExpense: true, editingExpenseId: 'e1' }), 'expense:e1');
	assert.equal(key({ isEditingExpense: true }), 'expense:invalid');
	assert.equal(
		key({ editingRecurringExpense: template, isEditingExpense: true, editingExpenseId: 'e1' }),
		'recurring:r1',
	);
});

test('the submit button names what gets saved', () => {
	assert.deepEqual(expenseSubmitLabel({ savesTemplate: true, editingRecurringExpense: template }), {
		text: { key: 'expenses-form.submit.saveTemplate' },
		accessibleName: { key: 'expenses-form.submit.saveTemplateAria' },
	});
	assert.deepEqual(
		expenseSubmitLabel({ savesTemplate: false, editingRecurringExpense: template }),
		{
			text: { key: 'expenses-form.submit.saveAsExpense' },
			accessibleName: { key: 'expenses-form.submit.saveAsExpense' },
		},
	);
	assert.deepEqual(expenseSubmitLabel({ savesTemplate: false, editingRecurringExpense: null }), {
		text: { key: 'expenses-form.submit.save' },
		accessibleName: { key: 'expenses-form.submit.saveAria' },
	});
});
