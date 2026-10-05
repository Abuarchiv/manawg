'use client';

import { apiFetch } from '@/core/infra/api-client';
import { notificationWarningMessage } from '@/core/notifications/notification-warning';
import { removeDraft } from '@/core/offline/drafts';
import { enqueueOfflineAction, readOfflineQueue } from '@/core/offline/offline-client';
import {
	DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_DRAFT_CLEANUP_FAILED_MESSAGE,
	OFFLINE_QUEUE_BLOCKED_DRAFT_MESSAGE,
} from '@/core/offline/offline-copy';
import {
	createOfflineIdempotencyKey,
	createQueuedExpense,
	createQueuedRecurring,
} from '@/core/offline/offline-queue';
import { parseEuroAmount } from '@/core/utils/amount';
import { todayAtLocalNoon } from '@/core/utils/local-date';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { addMonths, parseTimestamp } from '@/core/utils/time';
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
	recurringAdvanceWarningMessage,
	recurringTemplateDeleteErrorMessage,
	recurringTemplateSaveErrorMessage,
	splitInputErrorMessage,
} from '@/features/expenses/expense-errors';
import { manualSplitsFingerprint } from '@/features/expenses/expense-split-input';
import { buildOptimisticExpense } from '@/features/expenses/optimistic-expense';
import { findQueuedRecurringTemplate } from '@/features/expenses/queued-recurring-template';
import { formatIntervalLabel } from '@/features/expenses/recurring-expenses';
import type { DebtorShare } from '@/features/expenses/split-math';
import { useRef, useState } from 'react';
import type { ExpenseFormState, ExpensePageContext } from './expense-page-context';
import type { ExpenseFormSupport } from './use-expense-form-support';
import type { ExpenseCreateResponse } from './use-expense-submit';

const OFFLINE_RECURRING_EXPENSE_MESSAGE =
	'Fixkosten-Ausgabe offline vorgemerkt. Die Vorlage bleibt bis zur Synchronisierung unverändert.';

/**
 * Fixkosten-Vorlagen: save/edit a template, book an expense from one,
 * delete one, and advance a template's due date after it was booked.
 */
export function useRecurringExpenseActions(
	ctx: ExpensePageContext,
	form: ExpenseFormState,
	support: ExpenseFormSupport,
) {
	const {
		wg,
		identity,
		toast,
		notify,
		pending,
		recurringExpenses,
		updateExpenses,
		updateRecurringExpenses,
		reload,
		refreshQueuedCount,
	} = ctx;
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const recurringApiUrl = `/api/wg/${encodedShareCode}/recurring-expenses`;
	const [creatingRecurringId, setCreatingRecurringId] = useState<string | null>(null);
	const [savingRecurringTemplate, setSavingRecurringTemplate] = useState(false);
	const savingRecurringTemplateRef = useRef(false);
	const creatingRecurringRef = useRef(false);
	const expenseRequestsRef = useRef(
		new Map<string, { fingerprint: string; key: string; expectedRecurringNextDueAt: string }>(),
	);
	const templateRequestRef = useRef<{
		fingerprint: string;
		key: string;
		nextDueAt: string;
		anchorAt?: string;
		splits: DebtorShare[];
		queued?: boolean;
	} | null>(null);

	// Always awaited: a fire-and-forget version of this once existed alongside
	// this awaited one and could drop advance failures silently if the tab
	// closed right after submit, while this path always surfaced a warning.
	async function advanceRecurringTemplate(
		templateId: string,
		expectedNextDueAt: string | undefined,
	): Promise<boolean> {
		const advanceRes = await apiFetch<{ recurringExpense: RecurringExpense }>(recurringApiUrl, {
			method: 'PATCH',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({
				id: templateId,
				...(expectedNextDueAt ? { expectedNextDueAt } : {}),
			}),
		});
		if (advanceRes.ok) {
			updateRecurringExpenses((current) =>
				current.map((item) =>
					item.id === advanceRes.data.recurringExpense.id ? advanceRes.data.recurringExpense : item,
				),
			);
			return true;
		}
		if (advanceRes.status === 409 && advanceRes.error === 'recurring_expense_already_advanced') {
			await reload();
			return true;
		}
		notify.warning(recurringAdvanceWarningMessage(advanceRes.status, advanceRes.error));
		return false;
	}

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
			validationErrors.amount = amountErrorMessage(amountEuros);
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
		// A new template starts today and is first due one interval later. The
		// unclamped start day is sent as the anchor, so a template begun on the
		// 31st keeps billing on month ends instead of sticking to the 28th.
		const startsAt =
			editingRecurringExpense || queuedNextDueAt !== null
				? null
				: reusePendingRequest && pendingRequest
					? (pendingRequest.anchorAt ?? null)
					: todayAtLocalNoon().toISOString();
		const nextDueAt = editingRecurringExpense
			? new Date(editingRecurringExpense.nextDueAt)
			: queuedNextDueAt !== null
				? new Date(queuedNextDueAt)
				: reusePendingRequest && pendingRequest
					? new Date(pendingRequest.nextDueAt)
					: addMonths(new Date(startsAt ?? Date.now()), recurringIntervalMonths);
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
			memberToken: identity.memberToken,
			...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
			body: JSON.stringify({
				id: editingRecurringExpense?.id,
				description: desc,
				amountCents,
				paidByMemberId,
				intervalMonths: recurringIntervalMonths,
				nextDueAt: nextDueAt.toISOString(),
				...(editingRecurringExpense
					? { expectedNextDueAt: editingRecurringExpense.nextDueAt }
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

	async function createFromRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (creatingRecurringRef.current) return;
		const alreadyQueued = readOfflineQueue().some(
			(action) =>
				action.shareCode === wg.shareCode &&
				action.memberId === identity.memberId &&
				(action.wgId === undefined || action.wgId === wg.id) &&
				(action.type === 'expense.create' || action.type === 'recurring.advance') &&
				action.payload.recurringExpenseId === template.id &&
				action.payload.expectedRecurringNextDueAt === template.nextDueAt,
		);
		if (alreadyQueued) {
			notify.error(null);
			notify.warning(OFFLINE_RECURRING_EXPENSE_MESSAGE);
			return;
		}
		creatingRecurringRef.current = true;
		const finishCreating = () => {
			creatingRecurringRef.current = false;
			setCreatingRecurringId(null);
		};
		setCreatingRecurringId(template.id);
		notify.error(null);
		const requestBody = {
			description: template.description,
			amountCents: template.amountCents,
			paidByMemberId: template.paidByMemberId,
			splits: template.splits,
		};
		const fingerprint = JSON.stringify({ recurringExpenseId: template.id, ...requestBody });
		const pendingRequest = expenseRequestsRef.current.get(template.id);
		const reusePendingRequest = pendingRequest?.fingerprint === fingerprint;
		const expectedRecurringNextDueAt =
			reusePendingRequest && pendingRequest
				? pendingRequest.expectedRecurringNextDueAt
				: template.nextDueAt;
		const idempotencyKey =
			reusePendingRequest && pendingRequest ? pendingRequest.key : createOfflineIdempotencyKey();
		if (!idempotencyKey) {
			notify.error('Fixkosten-Ausgabe konnte nicht sicher gesendet werden. Versuche es erneut.');
			finishCreating();
			return;
		}
		expenseRequestsRef.current.set(template.id, {
			fingerprint,
			key: idempotencyKey,
			expectedRecurringNextDueAt,
		});
		const optimisticId = `pending:${idempotencyKey}`;
		const rollbackOptimisticExpense = () =>
			updateExpenses((current) => current.filter((expense) => expense.id !== optimisticId));
		const optimisticExpense = buildOptimisticExpense({
			id: optimisticId,
			description: template.description,
			amountCents: template.amountCents,
			paidByMemberId: template.paidByMemberId,
			imageUrl: null,
			splits: template.splits,
		});
		pending.start(optimisticId);
		updateExpenses((current) => [optimisticExpense, ...current]);
		const createRes = await apiFetch<ExpenseCreateResponse>(
			`/api/wg/${encodedShareCode}/expenses`,
			{
				method: 'POST',
				memberId: identity.memberId,
				memberToken: identity.memberToken,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					...requestBody,
					recurringExpenseId: template.id,
					expectedRecurringNextDueAt,
				}),
			},
		);
		if (!createRes.ok) {
			if (isPermanentClientError(createRes.status)) expenseRequestsRef.current.delete(template.id);
			if (createRes.status === 0) {
				const queuedCount = await enqueueOfflineAction(
					createQueuedExpense({
						wgId: wg.id,
						shareCode: wg.shareCode,
						memberId: identity.memberId,
						idempotencyKey,
						description: template.description,
						amountCents: template.amountCents,
						paidByMemberId: template.paidByMemberId,
						splits: template.splits,
						recurringExpenseId: template.id,
						expectedRecurringNextDueAt,
					}),
				);
				if (queuedCount === 0) {
					rollbackOptimisticExpense();
					pending.end(optimisticId);
					notify.error(
						'Offline-Speicher ist blockiert. Die Fixkosten-Ausgabe konnte nicht vorgemerkt werden.',
					);
					toast.error('Die Fixkosten-Ausgabe wurde zurückgesetzt.');
					finishCreating();
					return;
				}
				expenseRequestsRef.current.delete(template.id);
				refreshQueuedCount();
				notify.warning(OFFLINE_RECURRING_EXPENSE_MESSAGE);
				pending.end(optimisticId);
				finishCreating();
				return;
			}
			rollbackOptimisticExpense();
			pending.end(optimisticId);
			const message = 'Fixkosten-Ausgabe konnte nicht erstellt werden: Versuche es gleich erneut.';
			notify.error(message);
			toast.error(message);
			finishCreating();
			return;
		}
		updateExpenses((current) => {
			const withoutOptimistic = current.filter((expense) => expense.id !== optimisticId);
			return withoutOptimistic.some((expense) => expense.id === createRes.data.expense.id)
				? withoutOptimistic
				: [createRes.data.expense, ...withoutOptimistic];
		});
		pending.end(optimisticId);
		const advanced = await advanceRecurringTemplate(template.id, expectedRecurringNextDueAt);
		if (advanced) {
			expenseRequestsRef.current.delete(template.id);
			const pushWarning = notificationWarningMessage(createRes.data.warning);
			if (pushWarning) notify.warning(pushWarning);
			else notify.success('Fixkosten-Ausgabe wurde erstellt.');
		}
		finishCreating();
		void reload();
	}

	async function deleteRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (pending.isPending(template.id)) return;
		pending.start(template.id);
		notify.error(null);
		const previousTemplateIndex = recurringExpenses.findIndex((item) => item.id === template.id);
		updateRecurringExpenses((current) => current.filter((item) => item.id !== template.id));

		const res = await apiFetch<unknown>(recurringApiUrl, {
			method: 'DELETE',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
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
			const message = recurringTemplateDeleteErrorMessage(res.error);
			notify.error(message);
			toast.error(message);
			pending.end(template.id);
			return;
		}

		if (form.editingRecurringExpense?.id === template.id) {
			form.resetForm();
			form.setShowForm(false);
		}
		if (alreadyGone) {
			notify.error('Diese Fixkosten-Vorlage existiert nicht mehr und wurde entfernt.');
		} else {
			notify.success('Fixkosten-Vorlage gelöscht.');
		}
		pending.end(template.id);
		void reload();
	}

	return {
		advanceRecurringTemplate,
		saveRecurringTemplate,
		createFromRecurringTemplate,
		deleteRecurringTemplate,
		savingRecurringTemplate,
		creatingRecurringId,
		forgetPendingRequest: () => {
			templateRequestRef.current = null;
		},
	};
}
