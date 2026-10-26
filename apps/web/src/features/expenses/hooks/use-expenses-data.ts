'use client';

import type { ActionNotice } from '@/components/wg/ActionNoticeBanner';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { captureException } from '@/core/infra/capture-client';
import { syncOfflineActions } from '@/core/offline/offline-client';
import { useOfflineQueueSync } from '@/core/offline/useOfflineQueueSync';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import type {
	Expense,
	RecurringExpense,
} from '@/features/expenses/components/ausgaben/expense-types';
import { PAGE_REFRESH_MS } from '@/features/expenses/expense-constants';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateCachedList } from './cached-list';

interface UseExpensesDataOptions {
	shareCode: string;
	memberId: string;
	setActionNotice: (update: (current: ActionNotice | null) => ActionNotice | null) => void;
}

/**
 * Expenses, payments and recurring templates of the WG: cached read, reload
 * (also on a 30s visible-tab timer and after offline sync) and optimistic
 * updaters that write through to the shared fetch cache.
 */
export function useExpensesData({ shareCode, memberId, setActionNotice }: UseExpensesDataOptions) {
	const encodedShareCode = encodeURIComponent(shareCode);
	const {
		data: cachedExpenses,
		error: expensesReadError,
		refresh: refreshExpenses,
		setData: setCachedExpenses,
	} = useCachedFetch<{ expenses: Expense[]; payments?: ExpensePaymentInput[] }>(
		`/api/wg/${encodedShareCode}/expenses`,
		{ memberId },
	);
	const {
		data: cachedRecurringExpenses,
		error: recurringReadError,
		refresh: refreshRecurringExpenses,
		setData: setCachedRecurringExpenses,
	} = useCachedFetch<{ recurringExpenses: RecurringExpense[] }>(
		`/api/wg/${encodedShareCode}/recurring-expenses`,
		{ memberId },
	);

	const [expenses, setExpenses] = useState<Expense[]>(() => cachedExpenses?.expenses ?? []);
	const [payments, setPayments] = useState<ExpensePaymentInput[]>(
		() => cachedExpenses?.payments ?? [],
	);
	const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>(
		() => cachedRecurringExpenses?.recurringExpenses ?? [],
	);
	const [initialLoading, setInitialLoading] = useState(!cachedExpenses);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const loadRequestIdRef = useRef(0);
	const initialLoadStartedRef = useRef(false);
	const mountedRef = useRef(false);
	const hasPageCacheRef = useRef(Boolean(cachedExpenses));

	function updateExpenses(update: (current: Expense[]) => Expense[]): void {
		setExpenses(update);
		setCachedExpenses((current) => updateCachedList(current, 'expenses', expenses, update));
	}

	function updateRecurringExpenses(
		update: (current: RecurringExpense[]) => RecurringExpense[],
	): void {
		setRecurringExpenses(update);
		setCachedRecurringExpenses((current) =>
			updateCachedList(current, 'recurringExpenses', recurringExpenses, update),
		);
	}

	const load = useCallback(
		async (isInitial: boolean): Promise<Expense[] | null> => {
			const requestId = loadRequestIdRef.current + 1;
			loadRequestIdRef.current = requestId;
			if (isInitial && !hasPageCacheRef.current) setInitialLoading(true);
			else setRefreshing(true);

			const [res, recurringRes] = await Promise.all([
				refreshExpenses(),
				refreshRecurringExpenses(),
			]);
			const freshExpenses = res.ok ? res.data.expenses : null;
			// A newer load superseded this one; its result is the one to show.
			if (requestId !== loadRequestIdRef.current) return freshExpenses;
			if (!mountedRef.current) return freshExpenses;

			let nextLoadError: string | null = null;

			if (res.ok) {
				setExpenses(res.data.expenses);
				setPayments(res.data.payments ?? []);
				syncOfflineActions(shareCode, { memberId })
					.then((synced) => {
						if (!mountedRef.current) return;
						if (requestId !== loadRequestIdRef.current) return;
						refreshQueuedCount();
						if (synced > 0) {
							setActionNotice((current) => (current?.tone === 'warning' ? null : current));
							void load(false);
						}
					})
					.catch((err) =>
						captureException(err, { action: 'syncOfflineActions', page: 'ausgaben' }),
					);
			} else {
				nextLoadError = getWgLoadErrorMessage('Ausgaben', res.status, res.error, {
					verb: 'konnten',
				});
			}
			if (recurringRes.ok) setRecurringExpenses(recurringRes.data.recurringExpenses);
			else if (!nextLoadError) {
				nextLoadError = getWgLoadErrorMessage(
					'Fixkosten',
					recurringRes.status,
					recurringRes.error,
					{ verb: 'konnten' },
				);
			}
			setLoadError(nextLoadError);

			setInitialLoading(false);
			setRefreshing(false);
			return freshExpenses;
		},
		[memberId, refreshExpenses, refreshRecurringExpenses, shareCode, setActionNotice],
	);

	// Mirrors writes made through the shared cache (other tabs of the app,
	// other pages) into local state.
	useEffect(() => {
		if (cachedExpenses) {
			hasPageCacheRef.current = true;
			setExpenses(cachedExpenses.expenses);
			setPayments(cachedExpenses.payments ?? []);
			setLoadError(null);
			// The skeleton depends only on the expenses themselves, not on the recurring expenses.
			setInitialLoading(false);
		}
		if (cachedRecurringExpenses) {
			setRecurringExpenses(cachedRecurringExpenses.recurringExpenses);
			setLoadError(null);
		}
		if (expensesReadError) {
			setLoadError(
				getWgLoadErrorMessage('Ausgaben', expensesReadError.status, expensesReadError.error, {
					verb: 'konnten',
				}),
			);
		} else if (recurringReadError) {
			setLoadError(
				getWgLoadErrorMessage('Fixkosten', recurringReadError.status, recurringReadError.error, {
					verb: 'konnten',
				}),
			);
		}
	}, [cachedExpenses, cachedRecurringExpenses, expensesReadError, recurringReadError]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;
		void load(true);
	}, [load]);

	// Auto-refresh as on the dashboard; replaces the manual reload button.
	useVisibilityPausedInterval(() => void load(false), PAGE_REFRESH_MS);

	const { queuedCount, refreshCount: refreshQueuedCount } = useOfflineQueueSync({
		shareCode,
		memberId,
		page: 'ausgaben',
		onSynced: () => void load(false),
	});

	return {
		expenses,
		payments,
		recurringExpenses,
		initialLoading,
		refreshing,
		loadError,
		queuedCount,
		load,
		refreshQueuedCount,
		updateExpenses,
		updateRecurringExpenses,
	};
}
