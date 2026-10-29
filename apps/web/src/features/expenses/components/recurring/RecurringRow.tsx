'use client';

import { ChevronDown, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useWg } from '@/components/wg/WgContextProvider';
import { berlinDayKey } from '@/core/utils/berlin-day';
import { formatEuroCents } from '@/core/utils/money';
import { formatDayMonthYear, formatShortDate } from '@/core/utils/time';
import type { MemberOption, RecurringExpense } from '@/features/expenses/expense-types';
import {
	canManageRecurringTemplate,
	intervalLabelMessage,
	previewNextOccurrences,
} from '@/features/expenses/recurring-expenses';
import type { Locale } from '@/shared/i18n/locale';
import { useMessage } from '@/shared/i18n/message';

/** Yearly recurring expenses: without the year all dates would look the same (03.02., 03.02., 03.02.). */
function formatRecurringDate(iso: string, intervalMonths: number, locale: Locale): string {
	return intervalMonths >= 12
		? formatDayMonthYear(iso, locale)
		: formatShortDate(iso, 'Europe/Berlin', locale);
}

interface RecurringRowProps {
	recurringExpense: RecurringExpense;
	members: MemberOption[];
	pending: boolean;
	onEdit: (recurringExpense: RecurringExpense) => void;
	onTogglePause: (recurringExpense: RecurringExpense) => void;
	onDelete: (recurringExpense: RecurringExpense) => void;
}

export function RecurringRow({
	recurringExpense,
	members,
	pending,
	onEdit,
	onTogglePause,
	onDelete,
}: RecurringRowProps) {
	const t = useTranslations('expenses-recurring');
	const message = useMessage();
	const locale = useLocale();
	const dueDate = (iso: string) =>
		formatRecurringDate(iso, recurringExpense.intervalMonths, locale);
	const payer = members.find((member) => member.id === recurringExpense.paidByMemberId);
	const isPaused = recurringExpense.pausedAt !== null;
	const isOverdue =
		!isPaused && berlinDayKey(new Date(recurringExpense.nextDueAt)) < berlinDayKey(new Date());
	const preview = previewNextOccurrences(
		{
			nextDueAt: recurringExpense.nextDueAt,
			intervalMonths: recurringExpense.intervalMonths,
			anchorAt: recurringExpense.anchorAt,
		},
		3,
	);
	const { identity, isAdmin } = useWg();
	const canManage = canManageRecurringTemplate(recurringExpense, identity.memberId, isAdmin);
	const payerName = payer?.name ?? t('row.unknownPayer');
	// The cron pauses a template whose payer or debtor moved out; resuming needs new shares first.
	const involvesMovedOut = [
		recurringExpense.paidByMemberId,
		...recurringExpense.splits.map((split) => split.debtorMemberId),
	].some((id) => members.find((member) => member.id === id)?.active === false);
	const blockedByMovedOut = !isPaused && involvesMovedOut;
	return (
		<li className={isPaused ? 'text-muted-foreground' : undefined}>
			<Collapsible>
				<CollapsibleTrigger
					render={
						<Button
							variant="ghost"
							className="group h-auto w-full items-start justify-start gap-3 rounded-none px-3 py-2.5 text-left whitespace-normal hover:bg-transparent aria-expanded:bg-transparent active:bg-muted"
						/>
					}
				>
					<span className="mt-0.5 flex">
						<MemberAvatar name={payerName} size={28} />
					</span>
					{/* Amount to the right of the title; only when the row gets too narrow (320 px, large text) it goes below. */}
					<span className="@container flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 flex-col gap-0.5 @[14rem]:flex-row @[14rem]:items-baseline @[14rem]:gap-3">
							<span className="sr-only">{t('row.openDetails')}</span>
							<span className="min-w-0 flex-1 hyphens-auto text-body font-medium leading-snug [overflow-wrap:break-word]">
								{recurringExpense.description}
							</span>
							<span className="whitespace-nowrap font-mono tabular-nums @[14rem]:shrink-0">
								{formatEuroCents(recurringExpense.amountCents, recurringExpense.currency, {
									locale,
								})}
							</span>
						</span>
						<span className="text-meta leading-normal font-normal text-muted-foreground">
							{isPaused ? (
								involvesMovedOut ? (
									t('row.status.pausedMovedOut')
								) : (
									t('row.status.paused')
								)
							) : blockedByMovedOut ? (
								<span className="font-medium text-foreground">{t('row.status.notBooked')}</span>
							) : isOverdue ? (
								<span className="font-medium text-foreground">
									{t('row.status.overdue', { date: dueDate(recurringExpense.nextDueAt) })}
								</span>
							) : (
								t('row.status.next', { date: dueDate(recurringExpense.nextDueAt) })
							)}
							{` · ${message(intervalLabelMessage(recurringExpense.intervalMonths))} · `}
							<span className="sr-only">{t('row.paidBy')} </span>
							{recurringExpense.paidByMemberId === identity.memberId ? (
								<>
									<span aria-hidden>{t('row.you')}</span>
									<span className="sr-only">{t('row.youSpoken')}</span>
								</>
							) : (
								payerName
							)}
						</span>
					</span>
					<ChevronDown
						aria-hidden
						className="mt-0.5 size-4 shrink-0 text-muted-foreground group-aria-expanded:rotate-180"
					/>
				</CollapsibleTrigger>
				<CollapsiblePanel>
					<div className="flex flex-col gap-3 px-3 pt-1 pb-3">
						<ul className="flex flex-col gap-2">
							{recurringExpense.splits.map((split) => {
								const name =
									split.debtorMemberId === identity.memberId
										? t('row.youShare')
										: (members.find((member) => member.id === split.debtorMemberId)?.name ??
											t('row.unknownPayer'));
								return (
									<li
										key={split.debtorMemberId}
										className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
									>
										<span className="min-w-[10ch] flex-1 hyphens-auto [overflow-wrap:break-word]">
											{split.debtorMemberId === recurringExpense.paidByMemberId
												? t('row.ownShare', { name })
												: name}
										</span>
										<span className="ml-auto font-mono tabular-nums">
											{formatEuroCents(split.amountCents, recurringExpense.currency, { locale })}
										</span>
									</li>
								);
							})}
						</ul>
						{involvesMovedOut && (
							<p className="text-sm font-medium text-foreground">
								{isPaused ? t('row.movedOutPaused') : t('row.movedOutBlocked')}
							</p>
						)}
						{preview.length > 0 && !isPaused && !blockedByMovedOut && (
							<p className="text-sm text-muted-foreground">
								{t('row.nextBookings', {
									count: preview.length,
									dates: preview.map((date) => dueDate(date.toISOString())).join(', '),
								})}
							</p>
						)}
						{canManage ? (
							<div className="flex flex-wrap items-center gap-3 border-t pt-3">
								{/* Pausing is deliberately here rather than a switch in the row: no accidental taps. */}
								<Button
									variant="outline"
									onClick={() => onTogglePause(recurringExpense)}
									disabled={pending}
									aria-label={
										isPaused
											? t('row.resumeLabel', { description: recurringExpense.description })
											: t('row.pauseLabel', { description: recurringExpense.description })
									}
								>
									{isPaused ? (
										<Play data-icon="inline-start" />
									) : (
										<Pause data-icon="inline-start" />
									)}
									{isPaused ? t('row.resume') : t('row.pause')}
								</Button>
								<Button
									variant="outline"
									size="icon"
									onClick={() => onEdit(recurringExpense)}
									disabled={pending}
									aria-label={t('row.editLabel', { description: recurringExpense.description })}
								>
									<Pencil />
								</Button>
								<Button
									variant="outline"
									size="icon"
									className="text-destructive"
									onClick={() => onDelete(recurringExpense)}
									disabled={pending}
									aria-label={t('row.deleteLabel', { description: recurringExpense.description })}
								>
									<Trash2 />
								</Button>
							</div>
						) : (
							<p className="border-t pt-3 text-sm text-muted-foreground">{t('row.notAllowed')}</p>
						)}
					</div>
				</CollapsiblePanel>
			</Collapsible>
		</li>
	);
}
