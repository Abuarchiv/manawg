'use client';
import { useLocale, useTranslations } from 'next-intl';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { ThumbAction } from '@/components/wg/ThumbAction';
import { formatEuroCents } from '@/core/utils/money';
import { relativeTimeMessage } from '@/core/utils/time';
import { DebtRow } from '@/features/expenses/components/debts/DebtRow';
import { RemindButton } from '@/features/expenses/components/debts/RemindButton';
import { ReminderHistory } from '@/features/expenses/components/debts/ReminderHistory';
import type { ReminderHistoryItem } from '@/features/expenses/expense-types';
import {
	type ReminderRow,
	reminderKey,
	useRemindersPage,
} from '@/features/expenses/hooks/use-reminders-page';
import { useMessage } from '@/shared/i18n/message';

export default function RemindersPage() {
	const locale = useLocale();
	const t = useTranslations('expenses-debts.page');
	const tRemind = useTranslations('expenses-debts.remind');
	const message = useMessage();
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
		optedOutIds,
		markOptedOut,
		allClear,
	} = useRemindersPage();
	const wgBaseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;

	function reminderButton(row: ReminderRow, primary = false) {
		const debtorName = memberName(row.debtorId);
		const primaryLabel =
			row.creditorId === identity.memberId
				? tRemind('primaryOwn', { debtor: debtorName })
				: tRemind('primaryOther', {
						debtor: debtorName,
						creditor: memberName(row.creditorId),
						amount: formatEuroCents(row.amountCents, row.currency, { locale }),
					});
		const cooldown = cooldownFor(row.debtorId, row.creditorId, row.currency);
		// Keep it short ("in 2 days"): a long chip wraps below the row and makes it jump.
		const cooldownLabel = cooldown.nextAllowedAt
			? message(relativeTimeMessage(cooldown.nextAllowedAt.toISOString(), Date.now(), locale))
			: null;
		return (
			<RemindButton
				key={reminderKey(row)}
				shareCode={wg.shareCode}
				debtorMemberId={row.debtorId}
				creditorMemberId={row.creditorId}
				currency={row.currency}
				currentMemberId={identity.memberId}
				cooldownActive={!cooldown.allowed}
				cooldownLabel={cooldownLabel}
				debtorOptedOut={optedOutIds.has(row.debtorId)}
				onRejected={(kind) => {
					if (kind === 'optedOut') markOptedOut(row.debtorId);
					else void load(false);
				}}
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
									channel: 'pending',
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
				label={primary ? primaryLabel : tRemind('idle')}
				debtorName={debtorName}
			/>
		);
	}

	return (
		<div
			data-finance-content
			className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-3 px-4 py-3"
		>
			<header className="flex min-w-0 flex-wrap items-center gap-2">
				<BackLink href={`${wgBaseHref}/expenses`} label={t('back')} />
				<h1 className="font-heading min-w-0 flex-1 text-base font-semibold [overflow-wrap:normal] hyphens-auto">
					{t('title')}
				</h1>
				<output aria-live="polite" aria-hidden={!refreshing} className="sr-only">
					{t('loading')}
				</output>
			</header>
			{allClear ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>{t('allClear')}</EmptyTitle>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<section className="flex flex-col gap-2">
						<h2 className="text-meta font-medium text-muted-foreground">{t('openDebts')}</h2>
						{loadErrors.expenses && (
							<LoadErrorBanner
								message={loadErrors.expenses}
								onRetry={() => void load(true)}
								busy={loading || refreshing}
								retryLabel={t('reload')}
							/>
						)}
						{loading ? (
							<div
								className="flex flex-col gap-2"
								aria-busy="true"
								aria-label={t('openDebtsLoading')}
								role="status"
							>
								<div className="divide-y overflow-hidden rounded-xl border">
									<Skeleton className="h-[52px] w-full rounded-none" />
									<Skeleton className="h-[52px] w-full rounded-none" />
									<Skeleton className="h-[52px] w-full rounded-none" />
								</div>
							</div>
						) : expensesLoadFailed && rows.length === 0 ? null : rows.length === 0 ? (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>{t('allClear')}</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : (
							<ul className="divide-y overflow-hidden rounded-xl border">
								{rows.map((row) => (
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
											row === primaryReminder || !canRemind(row) || remindersLoadFailed
												? null
												: reminderButton(row)
										}
									/>
								))}
							</ul>
						)}
					</section>
					<section className="flex flex-col gap-2">
						<h2 className="text-meta font-medium text-muted-foreground">{t('recent')}</h2>
						{loadErrors.reminders && (
							<LoadErrorBanner
								message={loadErrors.reminders}
								onRetry={() => void load(true)}
								busy={loading || refreshing}
								retryLabel={t('reload')}
							/>
						)}
						{loading ? (
							<div className="flex flex-col gap-2" aria-hidden>
								<Skeleton className="h-[50px] w-full" />
								<Skeleton className="h-[50px] w-full" />
								<Skeleton className="h-[50px] w-full" />
							</div>
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
