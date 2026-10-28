'use client';

import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { resolveIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { removeDraft } from '@/core/offline/drafts';
import { enqueueOfflineAction, readOfflineQueue } from '@/core/offline/offline-client';
import { createQueuedRecurring } from '@/core/offline/offline-queue';
import { eurosToCents, parseEuroAmount } from '@/core/utils/amount';
import { todayAtLocalNoon } from '@/core/utils/local-date';
import { parseTimestamp } from '@/core/utils/time';
import { recurringIntervalLabel } from '@/features/expenses/expense-constants';
import { recurringTemplateSaveError, splitInputError } from '@/features/expenses/expense-errors';
import { manualSplitsFingerprint } from '@/features/expenses/expense-split-input';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import { findQueuedRecurringTemplate } from '@/features/expenses/queued-recurring-template';
import { planTemplateSchedule } from '@/features/expenses/recurring-template-plan';
import type { DebtorShare } from '@/features/expenses/split-math';
import { useMessage } from '@/shared/i18n/message';
import type { ExpenseFormState, ExpensePageContext } from './expense-page-context';
import { validateDescriptionAndAmount } from './expense-submit-validation';
import type { ExpenseFormSupport } from './use-expense-form-support';

/**
 * Saving a fixed-cost template from the expense form: create (idempotent, queued offline) or
 * edit (compare-and-set on the due date).
 */
export function useRecurringTemplateSave(
	ctx: ExpensePageContext,
	form: ExpenseFormState,
	support: ExpenseFormSupport,
) {
	const t = useMessage();
	const locale = useLocale();
	const { wg, identity, notify, updateRecurringExpenses, reload, refreshQueuedCount } = ctx;
	const recurringApiUrl = `/api/wg/${encodeURIComponent(wg.shareCode)}/recurring-expenses`;
	const [savingRecurringTemplate, setSavingRecurringTemplate] = useState(false);
	const savingRecurringTemplateRef = useRef(false);
	const templateRequestRef = useRef<{
		fingerprint: string;
		key: string;
		nextDueAt: string;
		anchorAt?: string;
		splits: DebtorShare[];
		queued?: boolean;
	} | null>(null);

	async function saveRecurringTemplate(): Promise<void> {
		if (savingRecurringTemplateRef.current) return;
		const { editingRecurringExpense, paidByMemberId, recurringIntervalMonths, splitMode } = form;
		support.setFieldErrors({});
		form.setFormError(null);
		const wasEditingQueuedRecurring = form.queueEditType === 'recurring.create';
		if (support.discardSentQueueEdit('recurring.create')) return;
		const desc = form.description.trim();
		const amountEuros = parseEuroAmount(form.amountStr, locale);
		const validationErrors = validateDescriptionAndAmount({
			description: desc,
			amountEuros,
			amountText: form.amountStr,
		});
		if (Object.keys(validationErrors).length > 0 || amountEuros === null) {
			support.setValidationErrors(validationErrors);
			return;
		}
		const amountCents = eurosToCents(amountEuros);
		const queuedNextDueAt =
			wasEditingQueuedRecurring && form.recurringNextDueAt
				? parseTimestamp(form.recurringNextDueAt)
				: null;
		const fingerprint = JSON.stringify({
			description: desc,
			category: form.category,
			amountCents,
			paidByMemberId,
			intervalMonths: recurringIntervalMonths,
			queuedNextDueAt: queuedNextDueAt === null ? null : new Date(queuedNextDueAt).toISOString(),
			splitMode,
			manualSplits: manualSplitsFingerprint(splitMode, form.manualSplits),
		});
		const pendingRequest = templateRequestRef.current;
		const reusePendingRequest =
			!editingRecurringExpense &&
			!pendingRequest?.queued &&
			pendingRequest?.fingerprint === fingerprint;
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
		const alreadyQueued = !editingRecurringExpense
			? findQueuedRecurringTemplate({
					queue: readOfflineQueue(),
					wgId: wg.id,
					shareCode: wg.shareCode,
					memberId: identity.memberId,
					description: desc,
					amountCents,
					paidByMemberId,
					intervalMonths: recurringIntervalMonths,
					splits,
					splitMode,
					queuedNextDueAt,
				})
			: undefined;
		if (alreadyQueued) {
			if (pendingRequest?.fingerprint === fingerprint) pendingRequest.queued = true;
			notify.warning(t({ key: 'expenses-form.notices.templateAlreadyQueued' }));
			return;
		}
		const { startsAt, nextDueAt } = planTemplateSchedule({
			editingNextDueAt: editingRecurringExpense?.nextDueAt ?? null,
			queuedNextDueAt,
			pending: reusePendingRequest && pendingRequest ? pendingRequest : null,
			intervalMonths: recurringIntervalMonths,
			today: todayAtLocalNoon,
		});
		const idempotencyKey = editingRecurringExpense
			? null
			: resolveIdempotencyKey(pendingRequest?.queued ? null : pendingRequest, fingerprint);
		if (!editingRecurringExpense && !idempotencyKey) {
			notify.error(t({ key: 'expenses-form.notices.keyUnavailableTemplate' }));
			return;
		}
		if (idempotencyKey) {
			templateRequestRef.current = {
				fingerprint,
				key: idempotencyKey,
				nextDueAt: nextDueAt.toISOString(),
				...(startsAt ? { anchorAt: startsAt } : {}),
				splits,
			};
		}
		savingRecurringTemplateRef.current = true;
		const finishSaving = () => {
			savingRecurringTemplateRef.current = false;
			setSavingRecurringTemplate(false);
		};
		setSavingRecurringTemplate(true);
		const res = await apiFetch<{ recurringExpense: RecurringExpense }>(recurringApiUrl, {
			method: editingRecurringExpense ? 'PATCH' : 'POST',
			memberId: identity.memberId,
			...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
			body: JSON.stringify({
				id: editingRecurringExpense?.id,
				description: desc,
				category: form.category,
				amountCents,
				paidByMemberId,
				intervalMonths: recurringIntervalMonths,
				nextDueAt: nextDueAt.toISOString(),
				...(editingRecurringExpense
					? {
							expectedNextDueAt: editingRecurringExpense.nextDueAt,
							...(editingRecurringExpense.updatedAt
								? { expectedUpdatedAt: editingRecurringExpense.updatedAt }
								: {}),
						}
					: {}),
				...(startsAt && !editingRecurringExpense ? { anchorAt: startsAt } : {}),
				splits,
			}),
		});
		if (!res.ok) {
			if (!editingRecurringExpense && shouldReleaseIdempotencyKey(res.status, res.error)) {
				templateRequestRef.current = null;
			}
			if (res.status === 0 && !editingRecurringExpense) {
				const queued = createQueuedRecurring({
					wgId: wg.id,
					shareCode: wg.shareCode,
					memberId: identity.memberId,
					...(idempotencyKey ? { idempotencyKey } : {}),
					description: desc,
					category: form.category,
					amountCents,
					paidByMemberId,
					intervalMonths: recurringIntervalMonths,
					nextDueAt: nextDueAt.toISOString(),
					...(startsAt ? { anchorAt: startsAt } : {}),
					splits,
				});
				if ((await enqueueOfflineAction(queued)) === 0) {
					notify.error(t({ key: 'expenses-form.notices.queueBlockedDraft' }));
					finishSaving();
					return;
				}
				if (templateRequestRef.current?.fingerprint === fingerprint) {
					templateRequestRef.current.queued = true;
				}
				refreshQueuedCount();
				updateRecurringExpenses((current) => [
					...current,
					{
						id: queued.id,
						description: desc,
						category: form.category,
						amountCents,
						currency: 'EUR',
						paidByMemberId,
						intervalMonths: recurringIntervalMonths,
						nextDueAt: nextDueAt.toISOString(),
						lastCreatedAt: null,
						pausedAt: null,
						splits,
					},
				]);
				if (!(await support.clearEditedQueueItem(['recurring.create']))) {
					notify.error(t({ key: 'expenses-form.notices.offlineDraftCleanupFailed' }));
					finishSaving();
					return;
				}
				if (wasEditingQueuedRecurring) {
					form.resetForm();
					form.setShowForm(false);
					removeDraft(form.draftKey);
				}
				notify.warning(t({ key: 'expenses-form.notices.templateSavedOffline' }));
				finishSaving();
				return;
			}
			if (
				editingRecurringExpense &&
				res.status === 404 &&
				res.error === 'recurring_expense_not_found'
			) {
				const staleId = editingRecurringExpense.id;
				form.resetForm();
				form.setShowForm(false);
				updateRecurringExpenses((current) => current.filter((item) => item.id !== staleId));
				notify.error(t({ key: 'expenses-form.notices.templateGoneRemoved' }));
				void reload();
				finishSaving();
				return;
			}
			form.setFormError(recurringTemplateSaveError(res.error));
			if (res.status === 409 && res.error === 'recurring_expense_changed') void reload();
			finishSaving();
			return;
		}
		templateRequestRef.current = null;
		updateRecurringExpenses((current) =>
			editingRecurringExpense
				? current.map((item) =>
						item.id === res.data.recurringExpense.id ? res.data.recurringExpense : item,
					)
				: current.some((item) => item.id === res.data.recurringExpense.id)
					? current
					: [...current, res.data.recurringExpense],
		);
		form.setEditingRecurringExpense(null);
		if (!(await support.clearEditedQueueItem(['recurring.create']))) {
			notify.error(t({ key: 'expenses-form.notices.draftCleanupFailed' }));
			finishSaving();
			return;
		}
		// A completed template edit must not turn the still-open form into a new expense.
		if (wasEditingQueuedRecurring || editingRecurringExpense) {
			form.resetForm();
			form.setShowForm(false);
			removeDraft(form.draftKey);
		}
		notify.success(
			t(
				editingRecurringExpense
					? { key: 'expenses-form.notices.templateUpdated' }
					: {
							key: 'expenses-form.notices.templateSaved',
							values: { interval: recurringIntervalLabel(recurringIntervalMonths) },
						},
			),
		);
		finishSaving();
	}

	return {
		saveRecurringTemplate,
		savingRecurringTemplate,
		forgetPendingRequest: () => {
			templateRequestRef.current = null;
		},
	};
}
