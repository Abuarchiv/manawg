'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Item, ItemContent, ItemFooter, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { isPayPalSdkEnabled } from '@/core/infra/security-headers';
import { formatEuroCents } from '@/core/utils/money';
import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import { PayPalPaymentButton } from '@/features/expenses/components/debts/PayPalPaymentButton';
import { RemindButton } from '@/features/expenses/components/debts/RemindButton';
import type { SimplifiedDebt } from '@/features/expenses/debt-reduction';
import { cn } from '@/shared/lib/cn';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { SettlementReviewDialog } from './SettlementReviewDialog';
import { useDebtSettlement } from './use-debt-settlement';

// Without PayPal credentials there is neither connecting nor paying, so no PayPal hints.
const PAYPAL_ENABLED = isPayPalSdkEnabled(
	process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
	process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
);

interface DebtRowProps {
	debt: SimplifiedDebt;
	expenses: readonly Expense[];
	shareCode: string;
	currentMemberId: string;
	memberPayPalMerchantId: (id: string) => string | null;
	payPalEligible: boolean;
	/** PayPal hint only in the first matching row per card. */
	showPayPalHint: boolean;
	onSettled: (message?: string) => void;
}

/** One simplified debt with settle, remind and PayPal actions for the members involved. */
export function SettlementDebtRow({
	debt,
	expenses,
	shareCode,
	currentMemberId,
	memberPayPalMerchantId,
	payPalEligible,
	showPayPalHint,
	onSettled,
}: DebtRowProps) {
	const settlement = useDebtSettlement({
		debt,
		shareCode,
		currentMemberId,
		onSettled,
	});
	const { reviewOpen, settling, reviewing, error, review } = settlement;
	const canSettle = debt.fromId === currentMemberId || debt.toId === currentMemberId;
	const payeeMerchantId = memberPayPalMerchantId(debt.toId);
	const canPayWithPayPal =
		(debt.currency ?? 'EUR') === 'EUR' &&
		debt.fromId === currentMemberId &&
		payeeMerchantId !== null &&
		payPalEligible &&
		PAYPAL_ENABLED;
	const iOwe = debt.fromId === currentMemberId;
	const owedToMe = debt.toId === currentMemberId;

	return (
		<Item size="sm" className="flex-wrap items-center gap-x-2.5 px-0 py-1">
			<div aria-hidden className="flex shrink-0 items-center -space-x-0.5">
				<MemberAvatar name={debt.fromName} size={24} className="ring-2 ring-card" />
				<MemberAvatar name={debt.toName} size={24} className="ring-2 ring-card" />
			</div>
			<ItemContent className="min-w-[7rem] flex-1">
				<ItemTitle className="line-clamp-none text-sm font-normal break-words">
					{iOwe ? 'Du' : debt.fromName} {iOwe ? 'schuldest' : 'schuldet'}{' '}
					{owedToMe ? 'dir' : debt.toName}
				</ItemTitle>
			</ItemContent>
			<span
				className={cn(
					'shrink-0 font-mono text-sm whitespace-nowrap tabular-nums',
					iOwe ? 'text-destructive' : owedToMe ? 'text-settled' : 'text-foreground',
				)}
			>
				{formatEuroCents(debt.cents, debt.currency)}
			</span>

			{canSettle && (
				<ItemFooter className="-mt-1 basis-full justify-start gap-2 pl-[54px] max-[359px]:pl-0 [&>*]:min-w-0">
					<Button
						variant={iOwe ? 'default' : 'outline'}
						size="sm"
						className="h-auto whitespace-normal"
						disabled={reviewing || settling}
						onClick={() => void review()}
					>
						{reviewing && <Spinner data-icon="inline-start" />}
						{reviewing ? 'Wird geprüft…' : 'Ausgleichen'}
					</Button>
					{owedToMe && (
						<RemindButton
							shareCode={shareCode}
							debtorMemberId={debt.fromId}
							creditorMemberId={debt.toId}
							currency={debt.currency ?? 'EUR'}
							currentMemberId={currentMemberId}
							size="sm"
						/>
					)}
					{PAYPAL_ENABLED && showPayPalHint && !payeeMerchantId && owedToMe && (
						<div className="col-span-full min-w-0">
							<p className="text-sm text-muted-foreground">
								Verbinde PayPal, damit andere Mitglieder dir Geld senden können.
							</p>
							<Link
								href={`/wg/${encodeURIComponent(shareCode)}/einstellungen`}
								className={cn(buttonVariants({ variant: 'link' }), 'min-h-11 justify-start px-0')}
							>
								PayPal verbinden
							</Link>
						</div>
					)}
					{PAYPAL_ENABLED && showPayPalHint && !payeeMerchantId && iOwe && (
						<p className="col-span-full text-sm text-muted-foreground">
							PayPal-Zahlungen sind erst möglich, wenn {debt.toName} PayPal verbunden hat.
						</p>
					)}
					{canPayWithPayPal && (
						<Collapsible className="basis-full">
							<CollapsibleTrigger
								render={<Button variant="outline" className="w-full justify-between" />}
							>
								Mit PayPal zahlen
								<ChevronDown data-icon="inline-end" />
							</CollapsibleTrigger>
							<CollapsibleContent>
								<PayPalPaymentButton
									shareCode={shareCode}
									currentMemberId={currentMemberId}
									fromMemberId={debt.fromId}
									toMemberId={debt.toId}
									payeeMerchantId={payeeMerchantId}
									amountCents={debt.cents}
									currency={debt.currency ?? 'EUR'}
									onPaid={onSettled}
								/>
							</CollapsibleContent>
						</Collapsible>
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
			/>
		</Item>
	);
}
