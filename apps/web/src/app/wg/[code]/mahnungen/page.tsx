'use client';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { BackLink } from '@/components/wg/BackLink';
import { DebtRow } from '@/components/wg/DebtRow';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { RemindButton } from '@/components/wg/RemindButton';
import { ReminderHistory, type ReminderHistoryItem } from '@/components/wg/ReminderHistory';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { apiFetch } from '@/core/infra/api-client';
import { formatRelativeTime } from '@/core/utils/time';
import { useVisibilityPausedInterval } from '@/core/utils/use-visibility-paused-interval';
import {
	type DebtExpenseInput,
	computeBalances,
	computeOldestDebtAges,
} from '@/features/expenses/debts';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payments';
import { REMINDER_COOLDOWN_HOURS, canSendReminder } from '@/features/expenses/reminders';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface ExpenseSplitDto {
	id: string;
	debtorMemberId: string;
	amountCents: number;
	settledAt: string | null;
}

interface ExpenseDto {
	id: string;
	paidByMemberId: string;
	occurredAt: string;
	splits: ExpenseSplitDto[];
}

// craftsman-ignore: TS002 — Next.js App Router requires default export from page.tsx
export default function MahnungenPage() {
	const { wg, members, identity } = useWg();
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;

	const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
	const [payments, setPayments] = useState<ExpensePaymentInput[]>([]);
	const [reminders, setReminders] = useState<ReminderHistoryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadErrors, setLoadErrors] = useState<{
		expenses: string | null;
		reminders: string | null;
	}>({ expenses: null, reminders: null });
	const [expensesLoadFailed, setExpensesLoadFailed] = useState(false);
	const [remindersLoadFailed, setRemindersLoadFailed] = useState(false);

	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			if (initial) setLoading(true);
			else setRefreshing(true);

			const [expensesRes, remindersRes] = await Promise.all([
				apiFetch<{ expenses: ExpenseDto[]; payments?: ExpensePaymentInput[] }>(
					`/api/wg/${encodedShareCode}/expenses`,
					{
						memberId: identity.memberId,
					},
				),
				apiFetch<{ reminders: ReminderHistoryItem[] }>(`/api/wg/${encodedShareCode}/reminders`, {
					memberId: identity.memberId,
				}),
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
					'Mahnungen',
					remindersRes.status,
					remindersRes.error,
					{
						verb: 'konnten',
					},
				);
			}
			setLoadErrors(nextErrors);
			if (initial) setLoading(false);
			else setRefreshing(false);
		},
		[encodedShareCode, identity.memberId],
	);

	useEffect(() => {
		void load(true);
	}, [load]);
	// Auto-Refresh wie auf dem Dashboard — ersetzt den manuellen Reload-Button.
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

	function cooldownFor(debtorId: string, creditorId: string) {
		return canSendReminder(
			debtorId,
			creditorId,
			reminders.map((r) => ({
				debtorMemberId: r.debtorMemberId,
				creditorMemberId: r.creditorMemberId,
				sentAt: r.sentAt,
			})),
		);
	}

	return (
		<div data-finance-content className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
			<header className="flex min-w-0 items-center gap-3">
				<BackLink href={`${wgBaseHref}/ausgaben`} label="Ausgaben" />
				<div className="min-w-0 flex-1">
					<h1 className="font-heading text-2xl font-semibold tracking-tight break-words">
						Mahnungen
					</h1>
					<p className="text-sm text-muted-foreground">
						Max. alle {REMINDER_COOLDOWN_HOURS} Stunden pro Person
					</p>
					<output aria-live="polite" aria-hidden={!refreshing} className="sr-only">
						<Spinner />
						Wird aktualisiert…
					</output>
				</div>
			</header>
			<section className="flex flex-col gap-3">
				<h2 className="text-base font-semibold">Offene Schulden</h2>
				{loadErrors.expenses && (
					<LoadErrorBanner
						message={loadErrors.expenses}
						onRetry={() => void load(true)}
						busy={loading || refreshing}
						retryLabel="Erneut laden"
					/>
				)}
				{loading ? (
					<div
						className="flex flex-col gap-3"
						aria-busy="true"
						aria-label="Offene Schulden werden geladen"
					>
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				) : expensesLoadFailed && rows.length === 0 ? null : rows.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>Alles ausgeglichen — nichts zu mahnen.</EmptyTitle>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="flex flex-col gap-3">
						{rows.map((row) => {
							const cooldown = cooldownFor(row.debtorId, row.creditorId);
							const cooldownLabel = cooldown.nextAllowedAt
								? `Wieder möglich ${formatRelativeTime(cooldown.nextAllowedAt.toISOString())}`
								: null;
							return (
								<DebtRow
									key={`${row.debtorId}:${row.creditorId}`}
									debtor={{
										id: row.debtorId,
										name: memberName(row.debtorId),
										color: memberColor(row.debtorId),
									}}
									creditor={{
										id: row.creditorId,
										name: memberName(row.creditorId),
										color: memberColor(row.creditorId),
									}}
									amountCents={row.amountCents}
									oldestDebtAgeDays={row.oldestAge}
									action={
										<RemindButton
											shareCode={wg.shareCode}
											debtorMemberId={row.debtorId}
											creditorMemberId={row.creditorId}
											currentMemberId={identity.memberId}
											memberToken={identity.memberToken}
											cooldownActive={!cooldown.allowed}
											cooldownLabel={cooldownLabel}
											onSent={() => void load(false)}
										/>
									}
								/>
							);
						})}
					</ul>
				)}
			</section>
			<section className="flex flex-col gap-3">
				<h2 className="text-base font-semibold">Letzte Mahnungen (30 Tage)</h2>
				{loadErrors.reminders && (
					<LoadErrorBanner
						message={loadErrors.reminders}
						onRetry={() => void load(true)}
						busy={loading || refreshing}
						retryLabel="Erneut laden"
					/>
				)}
				{loading ? (
					<Skeleton className="h-20 w-full" />
				) : remindersLoadFailed && reminders.length === 0 ? null : (
					<ReminderHistory items={reminders} memberName={memberName} />
				)}
			</section>
		</div>
	);
}
