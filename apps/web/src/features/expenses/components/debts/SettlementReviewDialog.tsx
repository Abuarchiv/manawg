'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { RefObject } from 'react';
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
	const { reviewOpen, setReviewOpen, settling, preview, error, settle, settleCash } = settlement;
	const money = (cents: number) => formatEuroCents(cents, debt.currency, { locale });
	return (
		<AlertDialog open={reviewOpen} onOpenChange={settlement.setReviewDialogOpen}>
			<AlertDialogContent className="max-h-[90dvh] overflow-y-auto" finalFocus={finalFocusRef}>
				<AlertDialogHeader className="place-items-start text-left">
					<AlertDialogTitle>{t('title')}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('body', {
							payerSelf: debt.fromId === currentMemberId ? 'yes' : 'no',
							payer: debt.fromName,
							amount: money(preview?.settleableCents || (preview?.netCents ?? 0)),
							payeeSelf: debt.toId === currentMemberId ? 'yes' : 'no',
							payee: debt.toName,
						})}
						{preview &&
							preview.settleableCents > 0 &&
							preview.settleableCents < preview.netCents &&
							` ${t('cashNote', { amount: money(preview.netCents) })}`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{(preview?.splits.length ?? 0) > 0 && (
					<ItemGroup aria-label={t('sharesLabel')}>
						{(preview?.splits ?? []).map((split) => {
							const expense = expenses.find((item) => item.id === split.expenseId);
							return (
								<ItemEntry
									key={split.id}
									variant="muted"
									size="xs"
									className="relative min-h-11 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50"
								>
									<ItemContent className="min-w-0 group-data-[size=xs]/item:gap-0.5">
										<ItemTitle className="line-clamp-none [overflow-wrap:break-word]">
											{expense ? (
												<Link
													href={`/wg/${encodeURIComponent(shareCode)}/ausgaben?highlight=${encodeURIComponent(split.expenseId)}`}
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
				)}
				{preview && preview.remainingCents > 0 && (
					<Alert>
						<AlertDescription>
							{t('remaining', { amount: money(preview.remainingCents) })}
						</AlertDescription>
					</Alert>
				)}
				<p className="text-xs text-muted-foreground">{t('checkedNote')}</p>

				{preview?.splits.length === 0 && (
					<Alert>
						<AlertDescription>{t('noShares')}</AlertDescription>
					</Alert>
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
					{preview && preview.netCents > 0 && (
						<Button
							variant="outline"
							className="h-auto min-h-11 whitespace-normal py-2 leading-snug"
							disabled={settling}
							onClick={() => void settleCash()}
						>
							{settling && <Spinner data-icon="inline-start" />}
							{settling ? t('saving') : t('recordCash', { amount: money(preview.netCents) })}
						</Button>
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
