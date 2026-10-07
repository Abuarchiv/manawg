import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import type { ReminderHistoryItem } from '@/features/expenses/components/debts/ReminderHistory';
import {
	type DebtExpenseInput,
	computeBalances,
	computeOldestDebtAges,
} from '@/features/expenses/debts';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payments';
import { canSendReminder } from '@/features/expenses/reminders';
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
 * Erinnerungen page: open debts derived from the expense list, the reminder history,
 * who may be reminded, and which reminder is offered as the primary action.
 */
export function useRemindersPage() {
	const { wg, members, identity, isAdmin } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const {
		data: cachedExpenses,
		error: expensesReadError,
		refresh: refreshExpenses,
	} = useCachedFetch<{ expenses: ExpenseDto[]; payments?: ExpensePaymentInput[] }>(
		`/api/wg/${encodedShareCode}/expenses`,
		{ memberId: identity.memberId },
	);
	const {
		data: cachedReminders,
		error: remindersReadError,
		refresh: refreshReminders,
		setData: setCachedReminders,
	} = useCachedFetch<{ reminders: ReminderHistoryItem[] }>(
		`/api/wg/${encodedShareCode}/reminders`,
		{ memberId: identity.memberId },
	);

	const [expenses, setExpenses] = useState<ExpenseDto[]>(() => cachedExpenses?.expenses ?? []);
	const [payments, setPayments] = useState<ExpensePaymentInput[]>(
		() => cachedExpenses?.payments ?? [],
	);
	const [reminders, setReminders] = useState<ReminderHistoryItem[]>(
		() => cachedReminders?.reminders ?? [],
	);
	const [loading, setLoading] = useState(!cachedExpenses && !cachedReminders);
	const [refreshing, setRefreshing] = useState(false);
	const [loadErrors, setLoadErrors] = useState<{
		expenses: string | null;
		reminders: string | null;
	}>({ expenses: null, reminders: null });
	const [expensesLoadFailed, setExpensesLoadFailed] = useState(false);
	const [remindersLoadFailed, setRemindersLoadFailed] = useState(false);
	const [primaryReminderKey, setPrimaryReminderKey] = useState<string | null>(null);
	// Server said 403 debtor_opted_out; the page has no data source for it, so remember it locally.
	const [optedOutIds, setOptedOutIds] = useState<ReadonlySet<string>>(() => new Set());
	const markOptedOut = useCallback((debtorId: string) => {
		setOptedOutIds((current) => new Set(current).add(debtorId));
	}, []);
	const hasPageCacheRef = useRef(Boolean(cachedExpenses || cachedReminders));

	function updateReminders(
		update: (current: ReminderHistoryItem[]) => ReminderHistoryItem[],
	): void {
		setReminders(update);
		setCachedReminders((current) => {
			const previous = current?.reminders ?? reminders;
			const next = update(previous);
			if (!current && next === previous) return current;
			return { ...(current ?? { reminders: previous }), reminders: next };
		});
	}

	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			if (initial && !hasPageCacheRef.current) setLoading(true);
			else setRefreshing(true);

			const [expensesRes, remindersRes] = await Promise.all([
				refreshExpenses(),
				refreshReminders(),
			]);

			const nextErrors: { expenses: string | null; reminders: string | null } = {
				expenses: null,
				reminders: null,
			};
			if (expensesRes.ok) {
				setExpenses(expensesRes.data.expenses);
				setPayments(expensesRes.data.payments ?? []);
				setExpensesLoadFailed(false);
			} else {
				setExpensesLoadFailed(true);
				nextErrors.expenses = getWgLoadErrorMessage(
					'Ausgaben',
					expensesRes.status,
					expensesRes.error,
					{
						verb: 'konnten',
					},
				);
			}
			if (remindersRes.ok) {
				setReminders(remindersRes.data.reminders);
				setRemindersLoadFailed(false);
			} else {
				setRemindersLoadFailed(true);
				nextErrors.reminders = getWgLoadErrorMessage(
					'Erinnerungen',
					remindersRes.status,
					remindersRes.error,
					{
						verb: 'konnten',
					},
				);
			}
			setLoadErrors(nextErrors);
			setLoading(false);
			setRefreshing(false);
		},
		[refreshExpenses, refreshReminders],
	);
	useEffect(() => {
		if (cachedExpenses) {
			hasPageCacheRef.current = true;
			setExpenses(cachedExpenses.expenses);
			setPayments(cachedExpenses.payments ?? []);
			setExpensesLoadFailed(false);
			setLoadErrors((current) => ({ ...current, expenses: null }));
		}
		if (cachedReminders) {
			hasPageCacheRef.current = true;
			setReminders(cachedReminders.reminders);
			setRemindersLoadFailed(false);
			setLoadErrors((current) => ({ ...current, reminders: null }));
		}
		if (cachedExpenses || cachedReminders) setLoading(false);
		if (expensesReadError) {
			setExpensesLoadFailed(true);
			setLoadErrors((current) => ({
				...current,
				expenses: getWgLoadErrorMessage(
					'Ausgaben',
					expensesReadError.status,
					expensesReadError.error,
					{ verb: 'konnten' },
				),
			}));
		}
		if (remindersReadError) {
			setRemindersLoadFailed(true);
			setLoadErrors((current) => ({
				...current,
				reminders: getWgLoadErrorMessage(
					'Erinnerungen',
					remindersReadError.status,
					remindersReadError.error,
					{ verb: 'konnten' },
				),
			}));
		}
	}, [cachedExpenses, cachedReminders, expensesReadError, remindersReadError]);

	useEffect(() => {
		void load(true);
	}, [load]);
	// Auto refresh like the dashboard instead of a manual reload button.
	useVisibilityPausedInterval(() => void load(false), 30_000);

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
		const oldestAges = computeOldestDebtAges(balances, debtExpenses);
		return balances
			.map((pair, i) => ({ ...pair, oldestAge: oldestAges[i] ?? 0 }))
			.sort((a, b) => b.amountCents - a.amountCents);
	}, [balances, debtExpenses]);

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
		!loadErrors.expenses &&
		!loadErrors.reminders &&
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
