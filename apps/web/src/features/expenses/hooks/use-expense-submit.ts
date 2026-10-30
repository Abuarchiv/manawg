'use client';

import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { resolveIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import {
	type NotificationWarning,
	notificationWarningMessage,
} from '@/core/notifications/notification-warning';
import { removeDraft } from '@/core/offline/drafts';
import { enqueueOfflineAction } from '@/core/offline/offline-client';
import { resolveSubmitImage } from '@/core/offline/resolve-submit-image';
import { eurosToCents, parseEuroAmount } from '@/core/utils/amount';
import {
	inputDateOrToday,
	inputDateToIso,
	isoToInputDate,
	todayInputValue,
} from '@/core/utils/local-date';
import {
	EDITED_EXPENSE_DELETED,
	expenseSaveError,
	splitInputError,
} from '@/features/expenses/expense-errors';
import { manualSplitsFingerprint } from '@/features/expenses/expense-split-input';
import type { Expense, RecurringExpense } from '@/features/expenses/expense-types';
import {
	buildOptimisticExpense,
	rollbackExpense,
	sortExpensesNewestFirst,
} from '@/features/expenses/optimistic-expense';
import { buildQueuedExpenseAction } from '@/features/expenses/queued-expense-action';
import type { DebtorShare } from '@/features/expenses/split-math';
import { type Message, useMessage } from '@/shared/i18n/message';
import type { ExpenseFormState, ExpensePageContext } from './expense-page-context';
import { validateExpenseFields } from './expense-submit-validation';
import type { ExpenseFormSupport } from './use-expense-form-support';
import type { AdvanceRecurringTemplate } from './use-recurring-booking';

export type ExpenseCreateResponse = {
	expense: Expense;
	warning: NotificationWarning;
	/** Set when the booking advanced its template; older servers and replays leave it out. */
	recurringExpense?: RecurringExpense;
};
type ExpenseMutationResponse = Expense | ExpenseCreateResponse;

/** Create/edit of one expense: validation, optimistic update, idempotent request (key reused
 * while the same unsent form is retried), offline queueing and the recurring-template advance. */
export function useExpenseSubmit(
	ctx: ExpensePageContext,
	form: ExpenseFormState,
	support: ExpenseFormSupport,
	advanceRecurringTemplate: AdvanceRecurringTemplate,
) {
	const {
		wg,
		identity,
		notify,
		pending,
		expenses,
		recurringExpenses,
		optimisticExpenses,
		updateExpenses,
		reload,
		refreshQueuedCount,
	} = ctx;
	const t = useMessage();
	const locale = useLocale();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const pendingRequestRef = useRef<{
		fingerprint: string;
		key: string;
		splits: DebtorShare[];
		expectedRecurringNextDueAt?: string;
		expectedRecurringUpdatedAt?: string;
	} | null>(null);

	async function submit(): Promise<void> {
		const {
			editingExpense,
			recurringSourceId,
			queueEditType,
			splitMode,
			paidByMemberId,
			imageUrl: formImageUrl,
		} = form;
		support.setFieldErrors({});
		if (form.invalidEditDraft) {
			form.setFormError({ key: 'expenses-form.notices.draftBroken' });
			return;
		}
		if (!submittingRef.current && support.discardSentQueueEdit('expense.create')) return;
		form.setFormError(null);
		form.setConflictExpenseId(null);
		const desc = form.description.trim();
		const amountEuros = parseEuroAmount(form.amountStr, locale);
		const occurredOn = inputDateOrToday(form.extras.pickedOccurredOn);
		const isEdit = editingExpense !== null;
		// Only a changed day is sent: an unchanged one keeps the real time of day.
		const previousExpense = isEdit
			? (expenses.find((expense) => expense.id === editingExpense.id) ?? null)
			: null;
		const shownDay = previousExpense
			? isoToInputDate(previousExpense.occurredAt)
			: todayInputValue();
		const validationErrors = validateExpenseFields(
			{
				description: desc,
				amountEuros,
				amountText: form.amountStr,
				occurredOn,
			},
			previousExpense ? shownDay : null,
		);
		if (Object.keys(validationErrors).length > 0 || amountEuros === null) {
			support.setValidationErrors(validationErrors);
			return;
		}
		const image = await resolveSubmitImage(formImageUrl, identity.memberId, navigator.onLine);
		if (!image) return form.setFormError({ key: 'expenses-form.notices.receiptUploadFailed' });
		const imageUrl = image.url;
		if (imageUrl !== formImageUrl) form.setImageUrl(imageUrl);
		const amountCents = eurosToCents(amountEuros);
		const fingerprint = JSON.stringify({
			recurringSourceId,
			description: desc,
			category: form.category,
			amountCents,
			paidByMemberId,
			imageUrl,
			splitMode,
			manualSplits: manualSplitsFingerprint(splitMode, form.manualSplits),
			participantIds: splitMode === 'equal' ? form.extras.participantIds : null,
			occurredOn,
		});
		const pendingRequest = pendingRequestRef.current;
		const reusePendingRequest = !isEdit && pendingRequest?.fingerprint === fingerprint;
		const recurringTemplateForCreate =
			!isEdit && recurringSourceId
				? recurringExpenses.find((item) => item.id === recurringSourceId)
				: null;
		// An edited queued booking keeps the template due date it was queued against.
		const queuedRecurringNextDueAt =
			!isEdit && recurringSourceId && queueEditType === 'expense.create'
				? form.recurringNextDueAt
				: null;
		const expectedRecurringNextDueAt = recurringSourceId
			? reusePendingRequest && pendingRequest?.expectedRecurringNextDueAt
				? pendingRequest.expectedRecurringNextDueAt
				: (queuedRecurringNextDueAt ?? recurringTemplateForCreate?.nextDueAt)
			: undefined;
		// Only a booking taken straight from the loaded template knows the version it was built from.
		const expectedRecurringUpdatedAt = recurringSourceId
			? reusePendingRequest && pendingRequest
				? pendingRequest.expectedRecurringUpdatedAt
				: queuedRecurringNextDueAt
					? undefined
					: recurringTemplateForCreate?.updatedAt
			: undefined;
		if (!isEdit && recurringSourceId && !expectedRecurringNextDueAt) {
			notify.error(t({ key: 'expenses-form.notices.templateUnavailable' }));
			return;
		}
		let splits: DebtorShare[];
		if (reusePendingRequest && pendingRequest) {
			splits = pendingRequest.splits;
		} else {
			const splitResult = support.buildSplits(amountCents);
			if (!splitResult.ok) {
				support.setValidationErrors({ splits: splitInputError(splitResult.reason) });
				return;
			}
			splits = splitResult.splits;
		}

		if (submittingRef.current) return;
		submittingRef.current = true;
		const finishSubmitting = () => {
			submittingRef.current = false;
			setSubmitting(false);
		};
		// Page banner for failures the form itself cannot show.
		const reportError = (message: string) => notify.error(message);
		setSubmitting(true);

		const recurringSource =
			recurringSourceId && expectedRecurringNextDueAt
				? {
						recurringExpenseId: recurringSourceId,
						expectedRecurringNextDueAt,
						...(expectedRecurringUpdatedAt ? { expectedRecurringUpdatedAt } : {}),
					}
				: {};
		const occurredAt = occurredOn !== shownDay ? inputDateToIso(occurredOn) : null;
		const requestBody = {
			...(occurredAt ? { occurredAt } : {}),
			paidByMemberId,
			amountCents,
			description: desc,
			category: form.category,
			imageUrl,
			splits,
			expectedUpdatedAt: editingExpense?.updatedAt,
			...recurringSource,
		};
		const idempotencyKey = isEdit ? null : resolveIdempotencyKey(pendingRequest, fingerprint);
		if (!isEdit && !idempotencyKey) {
			notify.error(t({ key: 'expenses-form.notices.keyUnavailableExpense' }));
			finishSubmitting();
			return;
		}
		if (!isEdit && idempotencyKey) {
			pendingRequestRef.current = {
				fingerprint,
				key: idempotencyKey,
				splits,
				...(expectedRecurringNextDueAt ? { expectedRecurringNextDueAt } : {}),
				...(expectedRecurringUpdatedAt ? { expectedRecurringUpdatedAt } : {}),
			};
		}
		const url = isEdit
			? `/api/wg/${encodedShareCode}/expenses/${encodeURIComponent(editingExpense.id)}`
			: `/api/wg/${encodedShareCode}/expenses`;
		const optimisticId = isEdit ? editingExpense.id : `pending:${idempotencyKey}`;
		const rollbackOptimisticExpense = () =>
			updateExpenses((current) => rollbackExpense(current, optimisticId, previousExpense));
		const optimisticExpense = buildOptimisticExpense({
			id: optimisticId,
			description: desc,
			category: form.category,
			amountCents,
			paidByMemberId,
			imageUrl,
			splits,
			...(occurredAt ? { occurredAt } : {}),
			...(previousExpense ? { previous: previousExpense } : {}),
		});
		pending.start(optimisticId);
		optimisticExpenses.set(optimisticExpense);
		updateExpenses((current) =>
			sortExpensesNewestFirst(
				isEdit
					? current.map((expense) =>
							expense.id === editingExpense.id ? optimisticExpense : expense,
						)
					: [optimisticExpense, ...current],
			),
		);
		const res = await apiFetch<ExpenseMutationResponse>(url, {
			method: isEdit ? 'PATCH' : 'POST',
			memberId: identity.memberId,
			...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
			body: JSON.stringify(requestBody),
		});

		if (!res.ok) {
			if (res.status === 0) {
				const queuedAction = buildQueuedExpenseAction({
					fields: {
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						description: desc,
						category: form.category,
						amountCents,
						paidByMemberId,
						splits,
						imageUrl,
					},
					occurredAt,
					edit: isEdit
						? { expenseId: editingExpense.id, expectedUpdatedAt: editingExpense.updatedAt }
						: null,
					idempotencyKey,
					recurring: recurringSource,
				});
				const queuedCount = await enqueueOfflineAction(queuedAction);
				if (queuedCount === 0) {
					rollbackOptimisticExpense();
					pending.end(optimisticId);
					finishSubmitting();
					reportError(t({ key: 'expenses-form.notices.queueBlockedDraft' }));
					return;
				}
				if (!isEdit) pendingRequestRef.current = null;
				refreshQueuedCount();
				if (!(await support.clearEditedQueueItem(['expense.create', 'expense.update']))) {
					pending.end(optimisticId);
					finishSubmitting();
					reportError(t({ key: 'expenses-form.notices.offlineDraftCleanupFailed' }));
					return;
				}
				form.resetForm();
				form.setShowForm(false);
				finishSubmitting();
				pending.end(optimisticId);
				removeDraft(form.draftKey);
				notify.warning(t({ key: 'expenses-form.notices.offlineSaved' }));
				return;
			}
			if (!isEdit && shouldReleaseIdempotencyKey(res.status, res.error)) {
				pendingRequestRef.current = null;
			}
			if (isEdit && res.status === 404 && res.error === 'expense_not_found') {
				form.setFormError(EDITED_EXPENSE_DELETED);
				updateExpenses((current) => current.filter((expense) => expense.id !== editingExpense.id));
				pending.end(optimisticId);
				reportError(t({ key: 'expenses.notices.expenseGone' }));
				void reload();
				finishSubmitting();
				return;
			}
			// Only the version check on edit is an edit conflict; other 409s
			// (e.g. recurring expense already taken over) have their own texts.
			const isConflict = res.status === 409 && res.error === 'expense_changed';
			const msg: Message = isConflict
				? { key: 'expenses-form.notices.conflict' }
				: expenseSaveError(res.error);
			if (isConflict) form.setConflictExpenseId(editingExpense?.id ?? null);
			rollbackOptimisticExpense();
			pending.end(optimisticId);
			form.setFormError(msg);
			finishSubmitting();
			// The template changed under the booking: show its current state.
			if (res.error === 'recurring_expense_changed') void reload();
			return;
		}

		if (!isEdit) pendingRequestRef.current = null;
		const savedExpense = 'expense' in res.data ? res.data.expense : res.data;
		const pushWarning = 'expense' in res.data ? notificationWarningMessage(res.data.warning) : null;
		updateExpenses((current) =>
			sortExpensesNewestFirst(
				isEdit
					? current.map((expense) => (expense.id === savedExpense.id ? savedExpense : expense))
					: [
							savedExpense,
							...current.filter(
								(expense) => expense.id !== optimisticId && expense.id !== savedExpense.id,
							),
						],
			),
		);
		pending.end(optimisticId);
		if (!(await support.clearEditedQueueItem(['expense.create', 'expense.update']))) {
			finishSubmitting();
			reportError(t({ key: 'expenses-form.notices.draftCleanupFailed' }));
			return;
		}
		form.resetForm();
		if (pushWarning) {
			notify.warning(t(pushWarning));
		} else {
			notify.success(
				t({ key: isEdit ? 'expenses-form.notices.updated' : 'expenses-form.notices.saved' }),
			);
		}
		if (recurringSourceId) {
			await advanceRecurringTemplate(
				recurringSourceId,
				expectedRecurringNextDueAt ??
					recurringExpenses.find((item) => item.id === recurringSourceId)?.nextDueAt,
				'expense' in res.data ? res.data.recurringExpense : undefined,
			);
		}
		form.setShowForm(false);
		finishSubmitting();
		removeDraft(form.draftKey);
		void reload();
	}

	return {
		submit,
		submitting,
		forgetPendingRequest: () => {
			pendingRequestRef.current = null;
		},
	};
}
