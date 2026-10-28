'use client';

import { useCallback, useRef } from 'react';
import type { ActionNotice } from '@/components/wg/ActionNoticeBanner';
import { wgLoadError } from '@/core/guards/load-errors';
import { type SyncedReloadReason, useSyncedCollection } from '@/core/sync/use-synced-collection';
import { LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';
import {
	assembleExpensesResponse,
	type ExpensesResponse,
} from '@/features/expenses/expense-list-response';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import type { Expense, RecurringExpense } from '@/features/expenses/expense-types';
import { useMessage } from '@/shared/i18n/message';

interface UseExpensesDataOptions {
	shareCode: string;
	memberId: string;
	setActionNotice: (update: (current: ActionNotice | null) => ActionNotice | null) => void;
}

const NO_PAYMENTS: ExpensePaymentInput[] = [];

/**
 * Expenses, payments and recurring templates of the WG, synced together: one load, poll and
 * offline replay refreshes both lists, because a queue flush also creates and advances templates.
 * Optimistic updaters write through to the shared fetch cache.
 */
export function useExpensesData({ shareCode, memberId, setActionNotice }: UseExpensesDataOptions) {
	const t = useMessage();
	const encodedShareCode = encodeURIComponent(shareCode);
	const loadAllRef = useRef<(silent: boolean) => Promise<unknown>>(async () => undefined);
	const reload = (reason: SyncedReloadReason) => void loadAllRef.current(reason !== 'mount');

	const expenses = useSyncedCollection<ExpensesResponse, Expense>({
		url: `/api/wg/${encodedShareCode}/expenses`,
		memberId,
		select: (data) => data.expenses,
		assemble: assembleExpensesResponse,
		getId: (expense) => expense.id,
		describeError: (error) =>
			t(wgLoadError({ key: 'common.loadError.lead.expenses' }, error.status, error.error)),
		pollIntervalMs: LIST_REFRESH_INTERVAL_MS,
		reload,
		offline: {
			shareCode,
			page: 'ausgaben',
			onReplayed: () =>
				setActionNotice((current) => (current?.tone === 'warning' ? null : current)),
		},
	});
	const recurring = useSyncedCollection<
		{ recurringExpenses: RecurringExpense[] },
		RecurringExpense
	>({
		url: `/api/wg/${encodedShareCode}/recurring-expenses`,
		memberId,
		select: (data) => data.recurringExpenses,
		assemble: (items, current) => ({ ...current, recurringExpenses: items }),
		getId: (template) => template.id,
		describeError: (error) =>
			t(wgLoadError({ key: 'expenses.page.loadRecurringLead' }, error.status, error.error)),
		// The expenses collection's mount load, poll and replay reload both lists.
		pollIntervalMs: null,
		reload: () => undefined,
	});

	const loadExpenses = expenses.load;
	const loadRecurring = recurring.load;
	const expensesItemsRef = expenses.itemsRef;
	const load = useCallback(
		async (initial: boolean, afterMutation = false): Promise<Expense[] | null> => {
			const options = { silent: !initial, afterMutation };
			const [result] = await Promise.all([loadExpenses(options), loadRecurring(options)]);
			// A newer load took over the flags; its answer is what the list already shows.
			if (result === null) return expensesItemsRef.current;
			return result.ok ? result.data.expenses : null;
		},
		[expensesItemsRef, loadExpenses, loadRecurring],
	);
	loadAllRef.current = (silent) => load(!silent);

	return {
		expenses: expenses.items,
		payments: expenses.data?.payments ?? NO_PAYMENTS,
		recurringExpenses: recurring.items,
		// The skeleton depends only on the expenses, not on the templates.
		initialLoading: expenses.initialLoading,
		refreshing: expenses.refreshing || recurring.refreshing,
		loadError: expenses.loadError ?? recurring.loadError,
		queuedCount: expenses.queuedCount,
		load,
		refreshQueuedCount: expenses.refreshCount,
		updateExpenses: expenses.commit,
		updateRecurringExpenses: recurring.commit,
		optimisticExpenses: expenses.pending,
	};
}
