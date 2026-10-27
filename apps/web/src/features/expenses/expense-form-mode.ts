import type { RecurringExpense } from '@/features/expenses/expense-types';

/** Sheet title for the form, by what it currently edits. */
export function expenseFormTitle(input: {
	editingRecurringExpense: RecurringExpense | null;
	isEditingQueuedRecurring: boolean;
	isEditingQueuedExpense: boolean;
	isEditingExpense: boolean;
}): string {
	if (input.editingRecurringExpense) return 'Fixkosten-Vorlage bearbeiten';
	if (input.isEditingQueuedRecurring) return 'Wartende Fixkosten-Vorlage bearbeiten';
	if (input.isEditingQueuedExpense) return 'Wartende Ausgabe bearbeiten';
	return input.isEditingExpense ? 'Ausgabe bearbeiten' : 'Ausgabe hinzufügen';
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
}): { text: string; accessibleName: string } {
	if (input.savesTemplate) {
		return { text: 'Vorlage speichern', accessibleName: 'Fixkosten-Vorlage speichern' };
	}
	if (input.editingRecurringExpense) {
		return { text: 'Als Ausgabe speichern', accessibleName: 'Als Ausgabe speichern' };
	}
	return { text: 'Speichern', accessibleName: 'Ausgabe speichern' };
}
