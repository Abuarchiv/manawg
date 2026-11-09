'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate } from '@/core/utils/time';
import type { SimplifiedDebt } from '@/features/expenses/debt-reduction';
import type { Expense } from '@/features/expenses/expense-types';
import type { DebtSettlement } from './use-debt-settlement';

/** Confirms a payment that already happened, listing the expense shares it settles. */
export function SettlementReviewDialog({
	debt,
	expenses,
	shareCode,
	settlement,
	finalFocusRef,
	currentMemberId,
}: {
	debt: SimplifiedDebt;
	expenses: readonly Expense[];
	shareCode: string;
	settlement: DebtSettlement;
	/** The settle button: the dialog has no trigger, so focus would otherwise fall back to body. */
	finalFocusRef: RefObject<HTMLElement | null>;
	currentMemberId: string;
}) {
	const locale = useLocale();
	const t = useTranslations('expenses-debts.review');
	const tSettle = useTranslations('expenses-debts.settle');
	const { reviewOpen, setReviewOpen, settling, reviewing, preview, error, settle, settleCash } =
		settlement;
	const money = (cents: number) => formatEuroCents(cents, debt.currency, { locale });
	const splits = preview?.splits ?? [];
	// The cash button is only worth showing when it covers more than the shares do (or all there is).
	const showCash = preview !== null && preview.netCents > preview.settleableCents;
	const sharesCoverPart = showCash && preview.settleableCents > 0;
	const shareList = (
		<ItemGroup aria-label={t('sharesLabel')}>
			{splits.map((split) => {
				const expense = expenses.find((item) => item.id === split.expenseId);
				return (
					<ItemEntry
						key={split.id}
						variant="muted"
						size="xs"
						className="relative min-h-11 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring"
					>
						<ItemContent className="min-w-0 group-data-[size=xs]/item:gap-0.5">
							<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
								{expense ? (
									<Link
										href={`/wg/${encodeURIComponent(shareCode)}/expenses?highlight=${encodeURIComponent(split.expenseId)}`}
										onClick={() => setReviewOpen(false)}
										className="underline underline-offset-4 outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
									>
										{expense.description}
									</Link>
								) : (
									<span>{t('expense')}</span>
								)}
							</ItemTitle>
							<ItemDescription className="line-clamp-none [overflow-wrap:break-word]">
								{split.offset
									? t('offset')
									: expense
										? formatShortDate(expense.occurredAt, undefined, locale)
										: t('currentShare')}
							</ItemDescription>
						</ItemContent>
						<Badge variant="outline" className="font-mono tabular-nums">
							{split.offset ? '−' : ''}
							{money(split.amountCents)}
						</Badge>
					</ItemEntry>
				);
			})}
		</ItemGroup>
	);
	return (
		<AlertDialog open={reviewOpen} onOpenChange={settlement.setReviewDialogOpen}>
			<AlertDialogContent
				className="max-h-[90dvh] overflow-y-auto"
				finalFocus={finalFocusRef}
				aria-busy={reviewing}
			>
				<AlertDialogHeader className="place-items-start text-left">
					<AlertDialogTitle>{t('title')}</AlertDialogTitle>
					<AlertDialogDescription render={<div />} className="w-full">
						{preview ? (
							t('body', {
								payerSelf: debt.fromId === currentMemberId ? 'yes' : 'no',
								payer: debt.fromName,
								amount: money(preview.settleableCents || preview.netCents),
								payeeSelf: debt.toId === currentMemberId ? 'yes' : 'no',
								payee: debt.toName,
							})
						) : (
							<span
								className="flex flex-col gap-1.5"
								role="status"
								aria-label={tSettle('checking')}
							>
								<Skeleton className="h-4 w-full" />
								<Skeleton className="h-4 w-2/3" />
							</span>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{!preview && <Skeleton className="h-11 w-full" />}
				{splits.length > 3 ? (
					<Collapsible>
						<CollapsibleTrigger
							render={
								<Button
									variant="ghost"
									size="sm"
									className="-mx-2.5 w-[calc(100%+1.25rem)] max-w-none"
								/>
							}
						>
							<span className="min-w-0 flex-1 text-left whitespace-normal">
								{t('sharesToggle', { count: String(splits.length) })}
							</span>
							<ChevronDown
								aria-hidden
								data-icon="inline-end"
								className="transition-transform group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
							/>
						</CollapsibleTrigger>
						<CollapsiblePanel>
							<div className="pt-2">{shareList}</div>
						</CollapsiblePanel>
					</Collapsible>
				) : (
					splits.length > 0 && shareList
				)}
				{preview && splits.length > 0 && preview.remainingCents > 0 && (
					<Alert>
						<AlertDescription>
							{t('remaining', { amount: money(preview.remainingCents) })}
						</AlertDescription>
					</Alert>
				)}
				{preview?.splits.length === 0 && (
					<Alert>
						<AlertDescription>{t('noShares')}</AlertDescription>
					</Alert>
				)}
				{preview && (
					<Collapsible>
						<CollapsibleTrigger
							render={
								<Button
									variant="ghost"
									size="sm"
									className="-mx-2.5 w-[calc(100%+1.25rem)] max-w-none"
								/>
							}
						>
							<span className="min-w-0 flex-1 text-left whitespace-normal">{t('details')}</span>
							<ChevronDown
								aria-hidden
								data-icon="inline-end"
								className="transition-transform group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
							/>
						</CollapsibleTrigger>
						<CollapsiblePanel>
							<div className="flex flex-col gap-2 pt-2 text-xs text-muted-foreground">
								<p>{t('checkedNote')}</p>
								{sharesCoverPart && <p>{t('cashNote', { amount: money(preview.netCents) })}</p>}
							</div>
						</CollapsiblePanel>
					</Collapsible>
				)}
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11" disabled={settling}>
						{t('cancel')}
					</AlertDialogCancel>
					{!preview && (
						<Button className="h-auto min-h-11 whitespace-normal py-2 leading-snug" disabled>
							<Spinner data-icon="inline-start" />
							{tSettle('checking')}
						</Button>
					)}
					{showCash && (
						<>
							{sharesCoverPart && (
								<p className="text-xs text-muted-foreground">{t('cashDiffers')}</p>
							)}
							<Button
								variant={sharesCoverPart ? 'outline' : 'default'}
								className="h-auto min-h-11 whitespace-normal py-2 leading-snug"
								disabled={settling}
								onClick={() => void settleCash()}
							>
								{settling && <Spinner data-icon="inline-start" />}
								{settling ? t('saving') : t('recordCash', { amount: money(preview.netCents) })}
							</Button>
						</>
					)}
					{preview && preview.settleableCents > 0 && (
						<Button
							className="h-auto min-h-11 whitespace-normal py-2 leading-snug"
							disabled={settling}
							onClick={() => void settle()}
						>
							{settling && <Spinner data-icon="inline-start" />}
							{settling ? t('saving') : t('recordPaid', { amount: money(preview.settleableCents) })}
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
