'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ItemContent, ItemEntry, ItemFooter, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { formatEuroCents } from '@/core/utils/money';
import { RemindButton } from '@/features/expenses/components/debts/RemindButton';
import type { SimplifiedDebt } from '@/features/expenses/debt-reduction';
import type { Expense } from '@/features/expenses/expense-types';
import { cn } from '@/shared/lib/cn';
import { SettlementReviewDialog } from './SettlementReviewDialog';
import { useDebtSettlement } from './use-debt-settlement';

/** Focus target when the row disappears after settling (heading in DebtSummary). */
export const BALANCE_HEADING_ID = 'balance-heading';

interface DebtRowProps {
	debt: SimplifiedDebt;
	expenses: readonly Expense[];
	shareCode: string;
	currentMemberId: string;
	/**
	 * A direct debt between the two covers this (possibly simplified) one. Reminders are booked
	 * on direct debts, so they are offered only then.
	 */
	backedByDirectDebt: boolean;
	onSettled: (message?: string) => void;
}

/** One simplified debt with settle and remind actions for the members involved. */
export function SettlementDebtRow({
	debt,
	expenses,
	shareCode,
	currentMemberId,
	backedByDirectDebt,
	onSettled,
}: DebtRowProps) {
	const locale = useLocale();
	const t = useTranslations('expenses-debts');
	const settledRef = useRef(false);
	const handleSettled = (message?: string) => {
		settledRef.current = true;
		onSettled(message);
	};
	const settlement = useDebtSettlement({
		debt,
		shareCode,
		currentMemberId,
		onSettled: handleSettled,
	});
	// When the row vanishes after our settlement, focus would otherwise land on body.
	useEffect(
		() => () => {
			if (settledRef.current && document.activeElement === document.body) {
				document.getElementById(BALANCE_HEADING_ID)?.focus();
			}
		},
		[],
	);
	const { reviewOpen, settling, reviewing, error, review } = settlement;
	const settleButtonRef = useRef<HTMLButtonElement>(null);
	const wasReviewingRef = useRef(false);
	// Chromium drops focus from the disabled button; restore it after the check (no dialog).
	useEffect(() => {
		if (wasReviewingRef.current && !reviewing && !reviewOpen) settleButtonRef.current?.focus();
		wasReviewingRef.current = reviewing;
	}, [reviewing, reviewOpen]);
	const canSettle = debt.fromId === currentMemberId || debt.toId === currentMemberId;
	const iOwe = debt.fromId === currentMemberId;
	const owedToMe = debt.toId === currentMemberId;
	const amount = formatEuroCents(debt.cents, debt.currency, { locale });

	return (
		<ItemEntry size="sm" className="flex-wrap items-center gap-x-2.5 px-0 py-1">
			<div aria-hidden className="flex shrink-0 items-center -space-x-0.5">
				<MemberAvatar name={debt.fromName} size={24} className="ring-2 ring-card" />
				<MemberAvatar name={debt.toName} size={24} className="ring-2 ring-card" />
			</div>
			<ItemContent className="min-w-[7rem] flex-1">
				<ItemTitle className="line-clamp-none text-sm font-normal break-words">
					{t('debtLine', {
						debtorSelf: iOwe ? 'yes' : 'no',
						debtor: debt.fromName,
						creditorSelf: owedToMe ? 'yes' : 'no',
						creditor: debt.toName,
					})}
				</ItemTitle>
			</ItemContent>
			<span
				className={cn(
					'shrink-0 font-mono text-sm whitespace-nowrap tabular-nums',
					iOwe ? 'text-destructive' : owedToMe ? 'text-settled' : 'text-foreground',
				)}
			>
				{amount}
			</span>

			{canSettle && (
				<ItemFooter className="-mt-1 basis-full justify-start gap-2 pl-[54px] max-[359px]:pl-0 [&>*]:min-w-0">
					<Button
						ref={settleButtonRef}
						variant={iOwe ? 'default' : 'outline'}
						size="sm"
						className="h-auto whitespace-normal"
						disabled={reviewing || settling}
						aria-label={
							reviewing
								? undefined
								: t('settle.buttonAria', { debtor: debt.fromName, creditor: debt.toName, amount })
						}
						onClick={() => void review()}
					>
						{reviewing && <Spinner data-icon="inline-start" />}
						{reviewing ? t('settle.checking') : t('settle.button')}
					</Button>
					{owedToMe && backedByDirectDebt && (
						<RemindButton
							shareCode={shareCode}
							debtorMemberId={debt.fromId}
							creditorMemberId={debt.toId}
							currency={debt.currency ?? 'EUR'}
							currentMemberId={currentMemberId}
							size="sm"
						/>
					)}
				</ItemFooter>
			)}
			{error && !reviewOpen && (
				<ItemFooter>
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				</ItemFooter>
			)}
			<SettlementReviewDialog
				debt={debt}
				expenses={expenses}
				shareCode={shareCode}
				settlement={settlement}
				finalFocusRef={settleButtonRef}
				currentMemberId={currentMemberId}
			/>
		</ItemEntry>
	);
}
