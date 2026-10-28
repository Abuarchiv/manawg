'use client';

import { useRef, useState } from 'react';
import { resolveIdempotencyKey, shouldReleaseIdempotencyKey } from '@/core/http/idempotency-key';
import { apiFetch } from '@/core/infra/api-client';
import { notificationWarningMessage } from '@/core/notifications/notification-warning';
import { enqueueOfflineAction, readOfflineQueue } from '@/core/offline/offline-client';
import { createQueuedExpense } from '@/core/offline/offline-queue';
import { expenseSaveError, recurringAdvanceWarning } from '@/features/expenses/expense-errors';
import type { RecurringExpense } from '@/features/expenses/expense-types';
import { buildOptimisticExpense } from '@/features/expenses/optimistic-expense';
import { withQueuedOccurredAt } from '@/features/expenses/queued-occurred-at';
import { rotateRemainderCents } from '@/features/expenses/recurring-split-rotation';
import { isRecurringBookingQueued } from '@/features/expenses/recurring-template-plan';
import { useMessage } from '@/shared/i18n/message';
import type { ExpensePageContext } from './expense-page-context';
import type { ExpenseCreateResponse } from './use-expense-submit';

/**
 * Advances a template after its booking. `served` is the template the create response
 * already advanced; the PATCH is only the fallback for a response without it (older replay bodies).
 */
export type AdvanceRecurringTemplate = (
	templateId: string,
	expectedNextDueAt: string | undefined,
	served?: RecurringExpense,
) => Promise<boolean>;

/**
 * Booking a due fixed cost: create the expense from the template, then advance the template's
 * due date. Offline, the expense is queued with the due date it books, so it is booked once.
 */
export function useRecurringBooking(ctx: ExpensePageContext) {
	const t = useMessage();
	const {
		wg,
		identity,
		notify,
		pending,
		optimisticExpenses,
		updateExpenses,
		updateRecurringExpenses,
		reload,
		refreshQueuedCount,
	} = ctx;
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const recurringApiUrl = `/api/wg/${encodedShareCode}/recurring-expenses`;
	const [creatingRecurringId, setCreatingRecurringId] = useState<string | null>(null);
	const creatingRecurringRef = useRef(false);
	const expenseRequestsRef = useRef(
		new Map<string, { fingerprint: string; key: string; expectedRecurringNextDueAt: string }>(),
	);

	// Always awaited, so an advance failure surfaces as a warning even if the tab closes next.
	const advanceRecurringTemplate: AdvanceRecurringTemplate = async (
		templateId,
		expectedNextDueAt,
		served,
	) => {
		if (served) {
			updateRecurringExpenses((current) =>
				current.map((item) => (item.id === served.id ? served : item)),
			);
			return true;
		}
		const advanceRes = await apiFetch<{ recurringExpense: RecurringExpense }>(recurringApiUrl, {
			method: 'PATCH',
			memberId: identity.memberId,
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
		notify.warning(t(recurringAdvanceWarning(advanceRes.status, advanceRes.error)));
		return false;
	};

	async function createFromRecurringTemplate(template: RecurringExpense): Promise<void> {
		if (creatingRecurringRef.current) return;
		const alreadyQueued = isRecurringBookingQueued(
			readOfflineQueue(),
			{ wgId: wg.id, shareCode: wg.shareCode, memberId: identity.memberId },
			template,
		);
		if (alreadyQueued) {
			notify.error(null);
			notify.warning(t({ key: 'expenses-form.notices.recurringQueued' }));
			return;
		}
		creatingRecurringRef.current = true;
		const finishCreating = () => {
			creatingRecurringRef.current = false;
			setCreatingRecurringId(null);
		};
		setCreatingRecurringId(template.id);
		notify.error(null);
		// The same cent rotation as the automatic booking, so a manual booking of this due date
		// charges the extra cent to the same person.
		const bookedSplits = rotateRemainderCents(
			template.splits,
			template.amountCents,
			new Date(template.nextDueAt),
			template.intervalMonths,
		);
		const requestBody = {
			description: template.description,
			category: template.category,
			amountCents: template.amountCents,
			paidByMemberId: template.paidByMemberId,
			splits: bookedSplits,
		};
		const fingerprint = JSON.stringify({ recurringExpenseId: template.id, ...requestBody });
		const pendingRequest = expenseRequestsRef.current.get(template.id);
		const reusePendingRequest = pendingRequest?.fingerprint === fingerprint;
		const expectedRecurringNextDueAt =
			reusePendingRequest && pendingRequest
				? pendingRequest.expectedRecurringNextDueAt
				: template.nextDueAt;
		const idempotencyKey = resolveIdempotencyKey(pendingRequest, fingerprint);
		if (!idempotencyKey) {
			notify.error(t({ key: 'expenses-form.notices.keyUnavailableRecurring' }));
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
			category: template.category,
			amountCents: template.amountCents,
			paidByMemberId: template.paidByMemberId,
			imageUrl: null,
			splits: bookedSplits,
		});
		pending.start(optimisticId);
		optimisticExpenses.set(optimisticExpense);
		updateExpenses((current) => [optimisticExpense, ...current]);
		const createRes = await apiFetch<ExpenseCreateResponse>(
			`/api/wg/${encodedShareCode}/expenses`,
			{
				method: 'POST',
				memberId: identity.memberId,
				headers: { 'Idempotency-Key': idempotencyKey },
				body: JSON.stringify({
					...requestBody,
					recurringExpenseId: template.id,
					expectedRecurringNextDueAt,
				}),
			},
		);
		if (!createRes.ok) {
			const releaseKey = shouldReleaseIdempotencyKey(createRes.status, createRes.error);
			if (releaseKey) expenseRequestsRef.current.delete(template.id);
			if (createRes.status === 0) {
				const queuedCount = await enqueueOfflineAction(
					withQueuedOccurredAt(
						createQueuedExpense({
							wgId: wg.id,
							shareCode: wg.shareCode,
							memberId: identity.memberId,
							idempotencyKey,
							description: template.description,
							amountCents: template.amountCents,
							paidByMemberId: template.paidByMemberId,
							splits: bookedSplits,
							recurringExpenseId: template.id,
							expectedRecurringNextDueAt,
						}),
						new Date().toISOString(),
					),
				);
				if (queuedCount === 0) {
					rollbackOptimisticExpense();
					pending.end(optimisticId);
					notify.error(t({ key: 'expenses-form.notices.recurringQueueBlocked' }));
					finishCreating();
					return;
				}
				expenseRequestsRef.current.delete(template.id);
				refreshQueuedCount();
				notify.warning(t({ key: 'expenses-form.notices.recurringQueued' }));
				pending.end(optimisticId);
				finishCreating();
				return;
			}
			rollbackOptimisticExpense();
			pending.end(optimisticId);
			notify.error(t(expenseSaveError(createRes.error)));
			finishCreating();
			// The template changed under us (already booked, paused or deleted): show its current state.
			if (releaseKey) void reload();
			return;
		}
		updateExpenses((current) => {
			const withoutOptimistic = current.filter((expense) => expense.id !== optimisticId);
			return withoutOptimistic.some((expense) => expense.id === createRes.data.expense.id)
				? withoutOptimistic
				: [createRes.data.expense, ...withoutOptimistic];
		});
		pending.end(optimisticId);
		const advanced = await advanceRecurringTemplate(
			template.id,
			expectedRecurringNextDueAt,
			createRes.data.recurringExpense,
		);
		if (advanced) {
			expenseRequestsRef.current.delete(template.id);
			const pushWarning = notificationWarningMessage(createRes.data.warning);
			if (pushWarning) notify.warning(t(pushWarning));
			else notify.success(t({ key: 'expenses-form.notices.recurringBooked' }));
		}
		finishCreating();
		void reload();
	}

	return { advanceRecurringTemplate, createFromRecurringTemplate, creatingRecurringId };
}
