'use client';

import { apiFetch } from '@/core/infra/api-client';
import { recurringTemplateDeleteError } from '@/features/expenses/expense-errors';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import { useMessage } from '@/shared/i18n/message';
import type { ExpenseFormState, ExpensePageContext } from './expense-page-context';
import type { ExpenseFormSupport } from './use-expense-form-support';
import { useRecurringBooking } from './use-recurring-booking';
import { useRecurringTemplateSave } from './use-recurring-template-save';

/**
 * Fixed-cost templates ("Fixkosten-Vorlagen"): save/edit a template, book an expense from one,
 * delete one, and advance a template's due date after it was booked.
 */
export function useRecurringExpenseActions(
	ctx: ExpensePageContext,
	form: ExpenseFormState,
	support: ExpenseFormSupport,
) {
	const t = useMessage();
	const { identity, notify, pending, recurringExpenses, updateRecurringExpenses, reload } = ctx;
	const recurringApiUrl = `/api/wg/${encodeURIComponent(ctx.wg.shareCode)}/recurring-expenses`;
	const templateSave = useRecurringTemplateSave(ctx, form, support);
	const booking = useRecurringBooking(ctx);

	async function deleteRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (pending.isPending(template.id)) return;
		pending.start(template.id);
		notify.error(null);
		const previousTemplateIndex = recurringExpenses.findIndex((item) => item.id === template.id);
		updateRecurringExpenses((current) => current.filter((item) => item.id !== template.id));

		const res = await apiFetch<unknown>(recurringApiUrl, {
			method: 'DELETE',
			memberId: identity.memberId,
			body: JSON.stringify({ id: template.id }),
		});

		const alreadyGone =
			!res.ok && res.status === 404 && res.error === 'recurring_expense_not_found';
		if (!res.ok && !alreadyGone) {
			updateRecurringExpenses((current) => {
				if (current.some((item) => item.id === template.id)) return current;
				const restored = [...current];
				restored.splice(Math.min(previousTemplateIndex, restored.length), 0, template);
				return restored;
			});
			notify.error(t(recurringTemplateDeleteError(res.error)));
			pending.end(template.id);
			return;
		}

		if (form.editingRecurringExpense?.id === template.id) {
			form.resetForm();
			form.setShowForm(false);
		}
		if (alreadyGone) {
			notify.error(t({ key: 'expenses.notices.templateGone' }));
		} else {
			notify.success(t({ key: 'expenses.notices.templateDeleted' }));
		}
		pending.end(template.id);
		void reload();
	}

	return {
		advanceRecurringTemplate: booking.advanceRecurringTemplate,
		saveRecurringTemplate: templateSave.saveRecurringTemplate,
		createFromRecurringTemplate: booking.createFromRecurringTemplate,
		deleteRecurringTemplate,
		savingRecurringTemplate: templateSave.savingRecurringTemplate,
		creatingRecurringId: booking.creatingRecurringId,
		forgetPendingRequest: templateSave.forgetPendingRequest,
	};
}
