'use client';
import { BackLink } from '@/components/wg/BackLink';
import { DebtRow } from '@/components/wg/DebtRow';
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
import { REMINDER_COOLDOWN_HOURS, canSendReminder } from '@/features/expenses/reminders';
import { AlertCircle, Loader2, RotateCw } from 'lucide-react';
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
	const [reminders, setReminders] = useState<ReminderHistoryItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const load = useCallback(
		async (initial: boolean): Promise<void> => {
			if (initial) setLoading(true);
			else setRefreshing(true);

			const [expensesRes, remindersRes] = await Promise.all([
				apiFetch<{ expenses: ExpenseDto[] }>(`/api/wg/${encodedShareCode}/expenses`, {
					memberId: identity.memberId,
				}),
				apiFetch<{ reminders: ReminderHistoryItem[] }>(`/api/wg/${encodedShareCode}/reminders`, {
					memberId: identity.memberId,
				}),
			]);

			let nextError: string | null = null;
			if (expensesRes.ok) setExpenses(expensesRes.data.expenses);
			else
				nextError = getWgLoadErrorMessage('Ausgaben', expensesRes.status, expensesRes.error, {
					verb: 'konnten',
				});
			if (remindersRes.ok) setReminders(remindersRes.data.reminders);
			else if (!nextError) {
				nextError = getWgLoadErrorMessage('Mahnungen', remindersRes.status, remindersRes.error, {
					verb: 'konnten',
				});
			}
			setLoadError(nextError);
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

	const balances = useMemo(() => computeBalances(debtExpenses), [debtExpenses]);

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
		<div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
			<header className="flex items-center gap-3">
				<BackLink href={`${wgBaseHref}/ausgaben`} label="Ausgaben" />
				<div className="min-w-0 flex-1">
					<h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
						Mahnungen
					</h1>
					<p className="mt-0.5 text-[13px] text-[var(--text-3)]">
						Max. alle {REMINDER_COOLDOWN_HOURS} Stunden pro Person
					</p>
				</div>
			</header>

			{loadError && (
				<div
					role="alert"
					className="flex items-center justify-between gap-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
				>
					<span>{loadError}</span>
					<button
						type="button"
						onClick={() => void load(true)}
						disabled={loading || refreshing}
						className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--danger)]/30 px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						<RotateCw className="h-3.5 w-3.5" aria-hidden />
						Erneut laden
					</button>
				</div>
			)}

			<section className="space-y-3">
				<h2 className="text-sm font-semibold text-[var(--text-1)]">Offene Schulden</h2>
				{loading ? (
					<div className="flex justify-center py-6">
						<Loader2 className="h-5 w-5 animate-spin text-[var(--text-3)]" aria-hidden />
					</div>
				) : rows.length === 0 ? (
					<div className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-[13px] text-[var(--text-3)]">
						Alles ausgeglichen — nichts zu mahnen.
					</div>
				) : (
					<ul className="space-y-2">
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

			<section className="space-y-3">
				<h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-1)]">
					<AlertCircle className="h-4 w-4 text-[var(--text-3)]" aria-hidden />
					Letzte Mahnungen (30 Tage)
				</h2>
				<ReminderHistory items={reminders} memberName={memberName} />
			</section>
		</div>
	);
}
