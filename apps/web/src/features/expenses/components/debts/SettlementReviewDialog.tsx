'use client';

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
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate } from '@/core/utils/time';
import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import type { SimplifiedDebt } from '@/features/expenses/debt-reduction';
import Link from 'next/link';
import type { RefObject } from 'react';
import type { DebtSettlement } from './use-debt-settlement';

/** Confirms a payment that already happened, listing the expense shares it settles. */
export function SettlementReviewDialog({
	debt,
	expenses,
	shareCode,
	settlement,
	finalFocusRef,
}: {
	debt: SimplifiedDebt;
	expenses: readonly Expense[];
	shareCode: string;
	settlement: DebtSettlement;
	/** Der Ausgleichen-Button: Der Dialog hat keinen Trigger, sonst fiele der Fokus auf body. */
	finalFocusRef: RefObject<HTMLElement | null>;
}) {
	const { reviewOpen, setReviewOpen, settling, preview, error, settle } = settlement;
	return (
		<AlertDialog open={reviewOpen} onOpenChange={settlement.setReviewDialogOpen}>
			<AlertDialogContent className="max-h-[90dvh] overflow-y-auto" finalFocus={finalFocusRef}>
				<AlertDialogHeader className="place-items-start text-left">
					<AlertDialogTitle>Bereits erfolgte Zahlung bestätigen</AlertDialogTitle>
					<AlertDialogDescription>
						Nur bestätigen, wenn {debt.fromName}{' '}
						{formatEuroCents(preview?.settleableCents ?? 0, debt.currency)} bereits an {debt.toName}{' '}
						gezahlt hat. Es wird kein Geld überwiesen.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ItemGroup aria-label="Unterstützte Ausgabenanteile">
					{(preview?.splits ?? []).map((split) => {
						const expense = expenses.find((item) => item.id === split.expenseId);
						return (
							<Item
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
											<span>Ausgabe</span>
										)}
									</ItemTitle>
									<ItemDescription>
										{expense ? formatShortDate(expense.occurredAt) : 'Aktueller offener Anteil'}
									</ItemDescription>
								</ItemContent>
								<Badge variant="outline" className="font-mono tabular-nums">
									{formatEuroCents(split.amountCents, debt.currency)}
								</Badge>
							</Item>
						);
					})}
				</ItemGroup>
				{preview && preview.remainingCents > 0 && (
					<Alert>
						<AlertDescription>
							{formatEuroCents(preview.remainingCents, debt.currency)} des verrechneten Saldos sind
							mit diesen Anteilen nicht verbuchbar und bleiben offen.
						</AlertDescription>
					</Alert>
				)}
				<p className="text-xs text-muted-foreground">
					Diese Anteile wurden aktuell geprüft. Ändern sie sich zwischenzeitlich, musst du die
					Zahlung erneut prüfen.
				</p>

				{preview?.splits.length === 0 && (
					<Alert>
						<AlertDescription>
							Keine direkt zuordenbaren Anteile. Es wird keine Zahlung eingetragen. Prüft die
							ursprünglichen Ausgaben einzeln.
						</AlertDescription>
					</Alert>
				)}
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<AlertDialogFooter className="flex-col">
					<AlertDialogCancel className="min-h-11" disabled={settling}>
						Abbrechen
					</AlertDialogCancel>
					{preview && preview.settleableCents > 0 && (
						<Button
							className="h-auto whitespace-normal"
							disabled={settling || !preview || preview.settleableCents <= 0}
							onClick={() => void settle()}
						>
							{settling && <Spinner data-icon="inline-start" />}
							{settling
								? 'Speichert…'
								: `${formatEuroCents(preview?.settleableCents ?? 0, debt.currency)} als bezahlt eintragen`}
						</Button>
					)}
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
