import type { RecurringExpense } from '@/features/expenses/expense-types';
import type { Message } from '@/shared/i18n/message';

/** Sheet title for the form, by what it currently edits. */
export function expenseFormTitle(input: {
	editingRecurringExpense: RecurringExpense | null;
	isEditingQueuedRecurring: boolean;
	isEditingQueuedExpense: boolean;
	isEditingExpense: boolean;
}): Message {
	if (input.editingRecurringExpense) return { key: 'expenses-form.title.editTemplate' };
	if (input.isEditingQueuedRecurring) return { key: 'expenses-form.title.editQueuedTemplate' };
	if (input.isEditingQueuedExpense) return { key: 'expenses-form.title.editQueuedExpense' };
	return { key: input.isEditingExpense ? 'expenses-form.title.edit' : 'expenses-form.title.add' };
}

/** Identity of what the form edits; a change means the form starts a different draft. */
export function expenseFormModeKey(input: {
	editingRecurringExpense: RecurringExpense | null;
	isEditingExpense: boolean;
	editingExpenseId: string | null;
}): string {
	if (input.editingRecurringExpense) return `recurring:${input.editingRecurringExpense.id}`;
	if (input.isEditingExpense) return `expense:${input.editingExpenseId ?? 'invalid'}`;
	return 'new';
}

/** Visible text of the submit button and its accessible name, which always contains that text. */
export function expenseSubmitLabel(input: {
	savesTemplate: boolean;
	editingRecurringExpense: RecurringExpense | null;
}): { text: Message; accessibleName: Message } {
	if (input.savesTemplate) {
		return {
			text: { key: 'expenses-form.submit.saveTemplate' },
			accessibleName: { key: 'expenses-form.submit.saveTemplateAria' },
		};
	}
	if (input.editingRecurringExpense) {
		const saveAsExpense: Message = { key: 'expenses-form.submit.saveAsExpense' };
		return { text: saveAsExpense, accessibleName: saveAsExpense };
	}
	return {
		text: { key: 'expenses-form.submit.save' },
		accessibleName: { key: 'expenses-form.submit.saveAria' },
	};
}
