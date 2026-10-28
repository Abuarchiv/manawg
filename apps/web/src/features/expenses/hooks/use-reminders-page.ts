import { useWg } from '@/components/wg/WgContextProvider';
import { wgLoadError } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/use-cached-fetch';
import { useSyncedCollection } from '@/core/sync/use-synced-collection';
import { LIST_REFRESH_INTERVAL_MS } from '@/core/utils/use-visibility-paused-interval';
import {
	type DebtExpenseInput,
	computeBalances,
	computeOldestDebtAges,
} from '@/features/expenses/debts';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import type { ReminderHistoryItem } from '@/features/expenses/expense-types';
import { canSendReminder } from '@/features/expenses/reminders';
import { type Message, useMessage } from '@/shared/i18n/message';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ExpenseSplitDto {
	id: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: string | null;
}

interface ExpenseDto {
	id: string;
	paidByMemberId: string;
	currency: string;
	occurredAt: string;
	splits: ExpenseSplitDto[];
}

const EXPENSES_LEAD: Message = { key: 'common.loadError.lead.expenses' };
const NO_EXPENSES: ExpenseDto[] = [];
const NO_PAYMENTS: ExpensePaymentInput[] = [];

/** An open debt between two members, with the age of its oldest unsettled share. */
export interface ReminderRow {
	debtorId: string;
	creditorId: string;
	currency: string;
	amountCents: number;
	oldestAge: number;
}

export function reminderKey(
	row: Pick<ReminderRow, 'currency' | 'debtorId' | 'creditorId'>,
): string {
	return `${row.currency}:${row.debtorId}:${row.creditorId}`;
}

/**
 * Reminders page: open debts derived from the expense list, the reminder history,
 * who may be reminded, and which reminder is offered as the primary action.
 */
export function useRemindersPage() {
	const { wg, members, identity, isAdmin } = useWg();
	const t = useMessage();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const {
		data: cachedExpenses,
		error: expensesReadError,
		refresh: refreshExpenses,
	} = useCachedFetch<{ expenses: ExpenseDto[]; payments?: ExpensePaymentInput[] }>(
		`/api/wg/${encodedShareCode}/expenses`,
		{ memberId: identity.memberId },
	);
	// The expenses are one document the balances derive from; the history list below is the
	// synced collection whose poll and mount load also refresh it.
	const loadAllRef = useRef<(silent: boolean) => Promise<void>>(async () => undefined);
	const history = useSyncedCollection<{ reminders: ReminderHistoryItem[] }, ReminderHistoryItem>({
		url: `/api/wg/${encodedShareCode}/reminders`,
		memberId: identity.memberId,
		select: (data) => data.reminders,
		assemble: (items, current) => ({ ...current, reminders: items }),
		getId: (reminder) => reminder.id,
		describeError: (error) =>
			t(wgLoadError({ key: 'expenses-debts.page.loadError.reminders' }, error.status, error.error)),
		pollIntervalMs: LIST_REFRESH_INTERVAL_MS,
		reload: (reason) => void loadAllRef.current(reason !== 'mount'),
	});
	const { items: reminders, commit: updateReminders } = history;
	const expenses = cachedExpenses?.expenses ?? NO_EXPENSES;
	const payments = cachedExpenses?.payments ?? NO_PAYMENTS;

	const [expensesSettled, setExpensesSettled] = useState(cachedExpenses !== undefined);
	const [expensesRefreshing, setExpensesRefreshing] = useState(false);
	const [expensesError, setExpensesError] = useState<Message | null>(null);
	const hasExpensesRef = useRef(cachedExpenses !== undefined);
	// The skeleton shows only when the page opened without any cached list, until both reads settled.
	const [openedWithoutCache] = useState(cachedExpenses === undefined && history.data === undefined);
	const loading = openedWithoutCache && (!expensesSettled || history.initialLoading);
	const refreshing = expensesRefreshing || history.refreshing;
	const loadErrors = { expenses: expensesError, reminders: history.loadError };
	const expensesLoadFailed = expensesError !== null;
	const remindersLoadFailed = history.loadError !== null;
	const [primaryReminderKey, setPrimaryReminderKey] = useState<string | null>(null);
	// Server said 403 debtor_opted_out; the page has no data source for it, so remember it locally.
	const [optedOutIds, setOptedOutIds] = useState<ReadonlySet<string>>(() => new Set());
	const markOptedOut = useCallback((debtorId: string) => {
		setOptedOutIds((current) => new Set(current).add(debtorId));
	}, []);

	const loadHistory = history.load;
	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			if (initial && !hasExpensesRef.current) setExpensesSettled(false);
			else setExpensesRefreshing(true);
			const [expensesRes] = await Promise.all([
				refreshExpenses(),
				loadHistory({ silent: !initial }),
			]);
			setExpensesError(
				expensesRes.ok ? null : wgLoadError(EXPENSES_LEAD, expensesRes.status, expensesRes.error),
			);
			setExpensesSettled(true);
			setExpensesRefreshing(false);
		},
		[loadHistory, refreshExpenses],
	);
	loadAllRef.current = (silent) => load(!silent);

	useEffect(() => {
		if (cachedExpenses) {
			hasExpensesRef.current = true;
			setExpensesError(null);
			setExpensesSettled(true);
		}
		if (expensesReadError) {
			setExpensesError(
				wgLoadError(EXPENSES_LEAD, expensesReadError.status, expensesReadError.error),
			);
		}
	}, [cachedExpenses, expensesReadError]);

	const memberName = useCallback(
		(id: string) => members.find((m) => m.id === id)?.name ?? '?',
		[members],
	);
	const memberColor = useCallback(
		(id: string) => members.find((m) => m.id === id)?.color ?? null,
		[members],
	);

	const debtExpenses = useMemo<DebtExpenseInput[]>(
		() =>
			expenses.map((expense) => ({
				paidByMemberId: expense.paidByMemberId,
				currency: expense.currency,
				occurredAt: expense.occurredAt,
				splits: expense.splits.map((split) => ({
					debtorMemberId: split.debtorMemberId,
					amountCents: split.amountCents,
					settledAt: split.settledAt,
				})),
			})),
		[expenses],
	);

	const balances = useMemo(() => computeBalances(debtExpenses, payments), [debtExpenses, payments]);

	const rows = useMemo(() => {
		const oldestAges = computeOldestDebtAges(balances, debtExpenses, new Date(), payments);
		return balances
			.map((pair, i) => ({ ...pair, oldestAge: oldestAges[i] ?? 0 }))
			.sort((a, b) => b.amountCents - a.amountCents);
	}, [balances, debtExpenses, payments]);

	function cooldownFor(debtorId: string, creditorId: string, currency: string) {
		return canSendReminder(
			debtorId,
			creditorId,
			reminders.map((r) => ({
				debtorMemberId: r.debtorMemberId,
				creditorMemberId: r.creditorMemberId,
				currency: r.currency,
				sentAt: r.sentAt,
			})),
			undefined,
			currency,
		);
	}

	// The API only lets the creditor (or the admin) remind, and only active debtors.
	const canRemind = (row: ReminderRow) =>
		(row.creditorId === identity.memberId || isAdmin) &&
		row.debtorId !== identity.memberId &&
		members.find((m) => m.id === row.debtorId)?.active !== false;
	// Without the history the cooldown is unknown, so no reminder is offered at all.
	const remindable = remindersLoadFailed
		? []
		: rows.filter((row) => canRemind(row) && !optedOutIds.has(row.debtorId));
	const mine = remindable.filter((row) => row.creditorId === identity.memberId);
	const pool = mine.length > 0 ? mine : remindable;
	const primaryReminder =
		pool.find((row) => reminderKey(row) === primaryReminderKey) ??
		pool.find((row) => cooldownFor(row.debtorId, row.creditorId, row.currency).allowed) ??
		null;

	const allClear =
		!loading &&
		rows.length === 0 &&
		reminders.length === 0 &&
		!expensesLoadFailed &&
		!remindersLoadFailed;

	return {
		wg,
		members,
		identity,
		loading,
		refreshing,
		loadErrors,
		expensesLoadFailed,
		remindersLoadFailed,
		load,
		reminders,
		updateReminders,
		setPrimaryReminderKey,
		memberName,
		memberColor,
		rows,
		cooldownFor,
		canRemind,
		primaryReminder,
		optedOutIds,
		markOptedOut,
		allClear,
	};
}
