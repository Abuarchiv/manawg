'use client';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { formatEuroCents } from '@/core/utils/money';
import { formatRelativeTime } from '@/core/utils/time';
import { DebtRow } from '@/features/expenses/components/debts/DebtRow';
import { RemindButton } from '@/features/expenses/components/debts/RemindButton';
import {
	ReminderHistory,
	type ReminderHistoryItem,
} from '@/features/expenses/components/debts/ReminderHistory';
import {
	type ReminderRow,
	reminderKey,
	useRemindersPage,
} from '@/features/expenses/hooks/use-reminders-page';

export default function ErinnerungenPage() {
	const {
		wg,
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
		allClear,
	} = useRemindersPage();
	const wgBaseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;

	function reminderButton(row: ReminderRow, primary = false) {
		const debtorName = memberName(row.debtorId);
		const primaryLabel =
			row.creditorId === identity.memberId
				? `${debtorName} erinnern`
				: `${debtorName} an ${memberName(row.creditorId)} erinnern · ${formatEuroCents(row.amountCents, row.currency)}`;
		const cooldown = cooldownFor(row.debtorId, row.creditorId, row.currency);
		const cooldownLabel = cooldown.nextAllowedAt
			? `Wieder möglich ${formatRelativeTime(cooldown.nextAllowedAt.toISOString())}`
			: null;
		return (
			<RemindButton
				key={reminderKey(row)}
				shareCode={wg.shareCode}
				debtorMemberId={row.debtorId}
				creditorMemberId={row.creditorId}
				currency={row.currency}
				currentMemberId={identity.memberId}
				memberToken={identity.memberToken}
				cooldownActive={!cooldown.allowed}
				cooldownLabel={cooldownLabel}
				onSent={(reminderId) => {
					if (primary) {
						setPrimaryReminderKey(null);
						const pendingPrefix = `pending:${reminderKey(row)}:`;
						updateReminders((current) => {
							const optimistic = current.find((item) => item.id.startsWith(pendingPrefix));
							const withoutPending = current.filter((item) => !item.id.startsWith(pendingPrefix));
							if (withoutPending.some((item) => item.id === reminderId)) return withoutPending;
							return optimistic
								? [{ ...optimistic, id: reminderId, channel: 'push' }, ...withoutPending]
								: withoutPending;
						});
					}
					void load(false);
				}}
				onOptimistic={
					primary
						? () => {
								const key = reminderKey(row);
								const optimisticId = `pending:${key}:${Date.now()}`;
								const optimistic: ReminderHistoryItem = {
									id: optimisticId,
									debtorMemberId: row.debtorId,
									creditorMemberId: row.creditorId,
									amountCents: row.amountCents,
									currency: row.currency,
									channel: 'Wird gesendet',
									sentAt: new Date().toISOString(),
									oldestDebtAgeDays: row.oldestAge,
								};
								setPrimaryReminderKey(key);
								updateReminders((current) => [optimistic, ...current]);
								return () => {
									setPrimaryReminderKey(null);
									updateReminders((current) => current.filter((item) => item.id !== optimisticId));
								};
							}
						: undefined
				}
				primary={primary}
				size={primary ? 'md' : 'sm'}
				label={primary ? primaryLabel : 'Erinnern'}
			/>
		);
	}

	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<header className="flex min-w-0 flex-wrap items-center gap-2">
				<BackLink href={`${wgBaseHref}/ausgaben`} label="Ausgaben" />
				<h1 className="font-heading min-w-0 flex-1 text-base font-semibold [overflow-wrap:normal] hyphens-auto">
					Erinnerungen
				</h1>
				<output aria-live="polite" aria-hidden={!refreshing} className="sr-only">
					<Spinner />
					Wird aktualisiert…
				</output>
			</header>
			{allClear ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Alles ausgeglichen. Nichts offen.</EmptyTitle>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<section className="flex flex-col gap-2">
						<h2 className="text-[12px] font-medium text-muted-foreground">Offene Schulden</h2>
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
								className="flex flex-col gap-2"
								aria-busy="true"
								aria-label="Offene Schulden werden geladen"
								// biome-ignore lint/a11y/useSemanticElements: role="status" names the loading region without swapping the wrapper element to <output>.
								role="status"
							>
								<Skeleton className="h-24 w-full" />
								<Skeleton className="h-24 w-full" />
							</div>
						) : expensesLoadFailed && rows.length === 0 ? null : rows.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>Alles ausgeglichen. Nichts offen.</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : (
							<ul className="divide-y overflow-hidden rounded-xl border">
								{rows.map((row) => {
									return (
										<DebtRow
											key={`${row.currency}:${row.debtorId}:${row.creditorId}`}
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
											currency={row.currency}
											oldestDebtAgeDays={row.oldestAge}
											currentMemberId={identity.memberId}
											action={
												row === primaryReminder || !canRemind(row) ? null : reminderButton(row)
											}
										/>
									);
								})}
							</ul>
						)}
					</section>
					<section className="flex flex-col gap-2">
						<h2 className="text-[12px] font-medium text-muted-foreground">
							Letzte Erinnerungen (30 Tage)
						</h2>
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
							<ReminderHistory
								items={reminders}
								memberName={memberName}
								currentMemberId={identity.memberId}
							/>
						)}
					</section>
				</>
			)}
			{primaryReminder && <ThumbAction>{reminderButton(primaryReminder, true)}</ThumbAction>}
		</div>
	);
}
