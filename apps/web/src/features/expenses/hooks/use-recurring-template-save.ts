'use client';

import { apiFetch } from '@/core/infra/api-client';
import { removeDraft } from '@/core/offline/drafts';
import { enqueueOfflineAction, readOfflineQueue } from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
} from '@/core/offline/offline-copy';
import { createOfflineIdempotencyKey, createQueuedRecurring } from '@/core/offline/offline-queue';
import { parseEuroAmount } from '@/core/utils/amount';
import { todayAtLocalNoon } from '@/core/utils/local-date';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { parseTimestamp } from '@/core/utils/time';
import type { ExpenseFormFieldErrors } from '@/features/expenses/components/ausgaben/ExpenseFormSection';
import {
	AMOUNT_MAX_EUROS,
	AMOUNT_MIN_EUROS,
	DESCRIPTION_MAX,
	amountErrorMessage,
} from '@/features/expenses/components/ausgaben/constants';
import type { RecurringExpense } from '@/features/expenses/components/ausgaben/expense-types';
import {
	isPermanentClientError,
	recurringTemplateSaveErrorMessage,
	splitInputErrorMessage,
} from '@/features/expenses/expense-errors';
import { manualSplitsFingerprint } from '@/features/expenses/expense-split-input';
import { findQueuedRecurringTemplate } from '@/features/expenses/queued-recurring-template';
import { formatIntervalLabel } from '@/features/expenses/recurring-expenses';
import { planTemplateSchedule } from '@/features/expenses/recurring-template-plan';
import type { DebtorShare } from '@/features/expenses/split-math';
import { useRef, useState } from 'react';
import type { ExpenseFormState, ExpensePageContext } from './expense-page-context';
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
		const amountEuros = parseEuroAmount(form.amountStr);
		const validationErrors: ExpenseFormFieldErrors = {};
		if (!desc || desc.length > DESCRIPTION_MAX) {
			validationErrors.description = 'Gib eine kurze Beschreibung ein.';
		}
		if (amountEuros === null || amountEuros < AMOUNT_MIN_EUROS || amountEuros > AMOUNT_MAX_EUROS) {
			validationErrors.amount = amountErrorMessage(amountEuros, form.amountStr);
		}
		if (Object.keys(validationErrors).length > 0 || amountEuros === null) {
			support.setValidationErrors(validationErrors);
			return;
		}
		const amountCents = Math.round(amountEuros * CENTS_PER_EURO);
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
				support.setValidationErrors({ splits: splitInputErrorMessage(splitResult.reason) });
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
			notify.warning(
				'Fixkosten-Vorlage ist bereits offline vorgemerkt. Synchronisiere oder löse die bestehende Aktion zuerst.',
			);
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
			: reusePendingRequest && pendingRequest
				? pendingRequest.key
				: createOfflineIdempotencyKey();
		if (!editingRecurringExpense && !idempotencyKey) {
			notify.error('Fixkosten-Vorlage konnte nicht sicher gespeichert werden. Versuche es erneut.');
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
			if (!editingRecurringExpense && isPermanentClientError(res.status)) {
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
					notify.error(OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE);
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
						splits,
					},
				]);
				if (!(await support.clearEditedQueueItem(['recurring.create']))) {
					notify.error(OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE);
					finishSaving();
					return;
				}
				if (wasEditingQueuedRecurring) {
					form.resetForm();
					form.setShowForm(false);
					removeDraft(form.draftKey);
				}
				notify.warning('Fixkosten-Vorlage offline gespeichert.');
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
				notify.error(
					'Diese Fixkosten-Vorlage existiert nicht mehr und wurde aus der Liste entfernt.',
				);
				void reload();
				finishSaving();
				return;
			}
			form.setFormError(recurringTemplateSaveErrorMessage(res.error));
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
			notify.error(DRAFT_CLEANUP_FAILED_MESSAGE);
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
			editingRecurringExpense
				? 'Fixkosten-Vorlage aktualisiert.'
				: `Als Vorlage gespeichert (${formatIntervalLabel(recurringIntervalMonths)}).`,
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
