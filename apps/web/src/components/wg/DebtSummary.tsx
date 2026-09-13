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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { PayPalPaymentButton } from '@/components/wg/PayPalPaymentButton';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import { formatShortDate } from '@/core/utils/time';
import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import type { SettlementSummary, SimplifiedDebt } from '@/features/expenses/debt-reduction';
import { Bell, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

function settlementErrorMessage(error: string): string {
	if (error === 'settlement_changed')
		return 'Die offenen Beträge haben sich geändert. Prüfe die Zahlung erneut, bevor du sie einträgst.';
	if (error === 'settlement_review_required')
		return 'Prüfe zuerst die betroffenen Ausgaben und den Betrag.';
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Ausgleich konnte nicht gespeichert werden: Versuche es gleich erneut.';
	}
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Ausgleich konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'wg_not_found') {
		return 'Ausgleich konnte nicht gespeichert werden: Öffne die WG über den aktuellen Link erneut.';
	}
	if (error === 'invalid_share_code') {
		return 'Ausgleich konnte nicht gespeichert werden: Der WG-Code ist ungültig.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return 'Ausgleich konnte nicht gespeichert werden: Tritt der WG erneut bei.';
	}
	if (error === 'member_not_in_wg') {
		return 'Ausgleich konnte nicht gespeichert werden: Mindestens ein Mitglied ist nicht mehr in dieser WG.';
	}
	if (error === 'not_party_to_debt') {
		return 'Ausgleich konnte nicht gespeichert werden: Du bist an dieser Schuld nicht beteiligt.';
	}
	if (error === 'same_member' || error === 'member_ids_invalid' || error === 'invalid_json') {
		return 'Ausgleich konnte nicht gespeichert werden: Die Anfrage war ungültig.';
	}
	if (error === 'paypal_payment_pending')
		return 'Eine PayPal-Zahlung läuft noch. Warte auf deren Abschluss.';
	return 'Ausgleich konnte nicht gespeichert werden.';
}

interface SettlementPreview {
	netCents: number;
	settleableCents: number;
	remainingCents: number;
	splits: Array<{ id: string; expenseId: string; amountCents: number }>;
	reason?: string;
}

interface DebtRowProps {
	debt: SimplifiedDebt;
	expenses: readonly Expense[];
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	memberPayPalMerchantId: (id: string) => string | null;
	payPalEligible: boolean;
	onSettled: (message?: string) => void;
}

interface SettleBatchResponse {
	settled: number;
	settledCents?: number;
	remainingCents?: number;
	reason?: string;
}

function DebtRow({
	debt,
	expenses,
	shareCode,
	currentMemberId,
	memberToken,
	memberPayPalMerchantId,
	payPalEligible,
	onSettled,
}: DebtRowProps) {
	const [reviewOpen, setReviewOpen] = useState(false);
	const [settling, setSettling] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [preview, setPreview] = useState<SettlementPreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const settlingRef = useRef(false);
	const canSettle = debt.fromId === currentMemberId || debt.toId === currentMemberId;
	const payeeMerchantId = memberPayPalMerchantId(debt.toId);
	const canPayWithPayPal =
		debt.fromId === currentMemberId &&
		payeeMerchantId !== null &&
		payPalEligible &&
		Boolean(
			process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID &&
				process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
		);
	const endpoint = `/api/wg/${encodeURIComponent(shareCode)}/expenses/settle-batch`;

	async function review(): Promise<void> {
		if (settlingRef.current) return;
		settlingRef.current = true;
		setReviewing(true);
		setError(null);
		try {
			const res = await apiFetch<SettlementPreview>(
				`${endpoint}?${new URLSearchParams({ fromMemberId: debt.fromId, toMemberId: debt.toId })}`,
				{ memberId: currentMemberId, memberToken },
			);
			if (res.ok) {
				setPreview(res.data);
				setReviewOpen(true);
			} else setError(settlementErrorMessage(res.error));
		} catch {
			setError(settlementErrorMessage('Netzwerkfehler'));
		} finally {
			settlingRef.current = false;
			setReviewing(false);
		}
	}

	async function settle(): Promise<void> {
		if (settlingRef.current || !preview || preview.settleableCents <= 0) return;
		settlingRef.current = true;
		setSettling(true);
		setError(null);
		try {
			const res = await apiFetch<SettleBatchResponse>(endpoint, {
				method: 'POST',
				memberId: currentMemberId,
				memberToken,
				body: JSON.stringify({
					fromMemberId: debt.fromId,
					toMemberId: debt.toId,
					expected: {
						netCents: preview.netCents,
						settleableCents: preview.settleableCents,
						splits: preview.splits.map(({ id, amountCents }) => ({ id, amountCents })),
					},
				}),
			});
			if (!res.ok) {
				setError(settlementErrorMessage(res.error));
				if (res.error === 'settlement_changed') {
					setPreview(null);
					setReviewOpen(false);
				}
				return;
			}
			const { settled, settledCents, remainingCents, reason } = res.data;
			setPreview(null);
			setReviewOpen(false);
			const message =
				reason === 'no_direct_splits'
					? 'Diese Verrechnung hat keine direkt zuordenbaren Anteile. Prüft die ursprünglichen Ausgaben einzeln.'
					: settled > 0
						? `Zahlung eingetragen: ${formatEuroCents(settledCents ?? 0)} von ${debt.fromName} an ${debt.toName}.${remainingCents ? ` ${formatEuroCents(remainingCents)} bleiben in der Verrechnung offen.` : ''}`
						: 'Keine Zahlung eingetragen. Die offenen Ausgaben werden neu geladen.';
			onSettled(message);
		} catch {
			setError(settlementErrorMessage('Netzwerkfehler'));
		} finally {
			settlingRef.current = false;
			setSettling(false);
		}
	}

	return (
		<Item variant="outline" className="items-start">
			<ItemContent className="min-w-0">
				<ItemTitle className="line-clamp-none break-words">
					{debt.fromId === currentMemberId ? 'Du' : debt.fromName}{' '}
					{debt.fromId === currentMemberId ? 'schuldest' : 'schuldet'}{' '}
					{debt.toId === currentMemberId ? 'dir' : debt.toName}
				</ItemTitle>
				<ItemDescription>Aus euren offenen Ausgaben verrechnet</ItemDescription>
			</ItemContent>
			<Badge variant="secondary" className="font-mono tabular-nums text-destructive">
				{formatEuroCents(debt.cents)}
			</Badge>

			{canSettle && (
				<ItemFooter className="flex-col items-stretch">
					<Button
						variant="outline"
						className="h-auto min-h-11 whitespace-normal"
						disabled={reviewing || settling}
						onClick={() => void review()}
					>
						{reviewing && <Spinner data-icon="inline-start" />}
						{reviewing ? 'Zahlung wird geprüft…' : 'Bereits erfolgte Zahlung eintragen'}
					</Button>
					{canPayWithPayPal && (
						<Collapsible>
							<CollapsibleTrigger
								render={<Button variant="outline" className="min-h-11 w-full justify-between" />}
							>
								Mit PayPal zahlen
								<ChevronDown data-icon="inline-end" />
							</CollapsibleTrigger>
							<CollapsibleContent>
								<PayPalPaymentButton
									shareCode={shareCode}
									currentMemberId={currentMemberId}
									memberToken={memberToken}
									fromMemberId={debt.fromId}
									toMemberId={debt.toId}
									payeeMerchantId={payeeMerchantId}
									amountCents={debt.cents}
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
			<AlertDialog
				open={reviewOpen}
				onOpenChange={(open) => {
					if (!settling) setReviewOpen(open);
				}}
			>
				<AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
					<AlertDialogHeader>
						<AlertDialogTitle>Zahlung prüfen</AlertDialogTitle>
						<AlertDialogDescription>
							{debt.fromName} hat {debt.toName} {formatEuroCents(preview?.settleableCents ?? 0)}{' '}
							bereits bezahlt. Nur die unten aufgeführten Direktanteile werden als beglichen
							vermerkt. Es wird kein Geld überwiesen.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ItemGroup aria-label="Unterstützte Ausgabenanteile">
						{(preview?.splits ?? []).map((split) => {
							const expense = expenses.find((item) => item.id === split.expenseId);
							return (
								<Item key={split.id} variant="muted" size="xs">
									<ItemContent className="min-w-0">
										<ItemTitle className="line-clamp-none break-words">
											<Link
												href={`/wg/${encodeURIComponent(shareCode)}/ausgaben?highlight=${encodeURIComponent(split.expenseId)}`}
												onClick={() => setReviewOpen(false)}
												className="underline underline-offset-4"
											>
												{expense?.description ?? 'Ausgabe'}
											</Link>
										</ItemTitle>
										<ItemDescription>
											{expense ? formatShortDate(expense.occurredAt) : 'Aktueller offener Anteil'}
										</ItemDescription>
									</ItemContent>
									<Badge variant="outline" className="font-mono tabular-nums">
										{formatEuroCents(split.amountCents)}
									</Badge>
								</Item>
							);
						})}
					</ItemGroup>
					{preview && preview.remainingCents > 0 && (
						<Alert>
							<AlertDescription>
								{formatEuroCents(preview.remainingCents)} des verrechneten Saldos sind mit diesen
								Anteilen nicht verbuchbar und bleiben offen.
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
					<AlertDialogFooter className="flex-col sm:flex-col">
						<AlertDialogCancel className="min-h-11" disabled={settling}>
							Abbrechen
						</AlertDialogCancel>
						{preview && preview.settleableCents > 0 && (
							<Button
								className="h-auto min-h-11 whitespace-normal"
								disabled={settling || !preview || preview.settleableCents <= 0}
								onClick={() => void settle()}
							>
								{settling && <Spinner data-icon="inline-start" />}
								{settling
									? 'Speichert…'
									: `${formatEuroCents(preview?.settleableCents ?? 0)} als bezahlt eintragen`}
							</Button>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Item>
	);
}

interface DebtSummaryProps {
	debts: SimplifiedDebt[];
	summary?: SettlementSummary;
	expenses: readonly Expense[];
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	memberColor: (id: string) => string | null;
	memberPayPalMerchantId?: (id: string) => string | null;
	onSettled: (message?: string) => void;
}

export function DebtSummary({
	debts,
	summary,
	expenses,
	shareCode,
	currentMemberId,
	memberToken,
	memberPayPalMerchantId = () => null,
	onSettled,
}: DebtSummaryProps) {
	if (debts.length === 0) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>Offene Zahlungen</h2>
				</CardTitle>
				<CardDescription>
					{summary && summary.savedTransfers > 0
						? `Minimaler Ausgleich: ${summary.simplifiedCount} statt ${summary.directCount} Überweisungen. Spart ${summary.savedTransfers} Zahlungen.`
						: 'Wer wem noch Geld schuldet'}
				</CardDescription>
				<Button
					variant="outline"
					className="min-h-11"
					render={<Link href={`/wg/${encodeURIComponent(shareCode)}/mahnungen`} />}
					nativeButton={false}
				>
					<Bell data-icon="inline-start" />
					Mahnungen
				</Button>
			</CardHeader>
			<CardContent>
				<ItemGroup>
					{(summary?.simplified.length ? summary.simplified : debts).map((debt) => (
						<DebtRow
							key={`${debt.fromId}-${debt.toId}`}
							debt={debt}
							expenses={expenses}
							shareCode={shareCode}
							currentMemberId={currentMemberId}
							memberToken={memberToken}
							memberPayPalMerchantId={memberPayPalMerchantId}
							payPalEligible={
								summary === undefined ||
								debts.some(
									(direct) =>
										direct.fromId === debt.fromId &&
										direct.toId === debt.toId &&
										direct.cents >= debt.cents,
								)
							}
							onSettled={onSettled}
						/>
					))}
				</ItemGroup>
			</CardContent>
		</Card>
	);
}
