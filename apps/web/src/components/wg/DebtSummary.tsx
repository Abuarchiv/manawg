'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
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
import { Bell, CheckCircle2, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

function settlementErrorMessage(error: string): string {
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

interface SettlementRecord {
	id: string;
	description: string;
	occurredAt: string;
	amountCents: number;
}

// Read-only preview of settle-batch's oldest-first, whole-direct-share scope.
// The response remains authoritative if another resident changes an expense.
function settlementRecords(expenses: readonly Expense[], debt: SimplifiedDebt): SettlementRecord[] {
	const candidates = expenses
		.flatMap((expense) =>
			expense.paidByMemberId !== debt.toId
				? []
				: expense.splits
						.filter(
							(split) =>
								split.debtorMemberId === debt.fromId &&
								split.settledAt === null &&
								split.amountCents > 0,
						)
						.map((split) => ({
							id: split.id,
							amountCents: split.amountCents,
							description: expense.description,
							occurredAt: expense.occurredAt,
						})),
		)
		.sort(
			(a, b) =>
				new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime() ||
				a.id.localeCompare(b.id),
		);
	let remaining = debt.cents;
	return candidates.filter((record) => {
		if (record.amountCents > remaining) return false;
		remaining -= record.amountCents;
		return true;
	});
}

interface DebtRowProps {
	debt: SimplifiedDebt;
	records: SettlementRecord[];
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	memberPayPalMerchantId: (id: string) => string | null;
	payPalEligible: boolean;
	onSettled: () => void;
}

interface SettleBatchResponse {
	settled: number;
	settledCents?: number;
	remainingCents?: number;
	reason?: string;
}

function DebtRow({
	debt,
	records,
	shareCode,
	currentMemberId,
	memberToken,
	memberPayPalMerchantId,
	payPalEligible,
	onSettled,
}: DebtRowProps) {
	const [settling, setSettling] = useState(false);
	const [settlementMessage, setSettlementMessage] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reviewOpen, setReviewOpen] = useState(false);
	const settlingRef = useRef(false);
	const canSettle = debt.fromId === currentMemberId || debt.toId === currentMemberId;
	const payeeMerchantId = memberPayPalMerchantId(debt.toId);
	const canPayWithPayPal =
		debt.fromId === currentMemberId && payeeMerchantId !== null && payPalEligible;
	const supportedCents = records.reduce((total, record) => total + record.amountCents, 0);

	async function settle(): Promise<void> {
		if (settlingRef.current || records.length === 0) return;
		settlingRef.current = true;
		setError(null);
		setNotice(null);
		setSettling(true);
		try {
			const res = await apiFetch<SettleBatchResponse>(
				`/api/wg/${encodeURIComponent(shareCode)}/expenses/settle-batch`,
				{
					method: 'POST',
					memberId: currentMemberId,
					memberToken,
					body: JSON.stringify({ fromMemberId: debt.fromId, toMemberId: debt.toId }),
				},
			);
			if (res.ok) {
				const { settled, settledCents, remainingCents, reason } = res.data;
				if (reason === 'no_direct_splits') {
					// The debt only exists via netting through other members — there
					// is nothing to mark settled between exactly these two. Keep the
					// row visible instead of pretending the pair is even.
					setNotice(
						`Keine passenden Direktanteile geändert. ${formatEuroCents(remainingCents ?? debt.cents)} bleiben offen; prüfe die einzelnen Ausgaben.`,
					);
					return;
				}
				if (settled > 0 && remainingCents && remainingCents > 0) {
					setNotice(
						`Teilweise verbucht: ${formatEuroCents(settledCents ?? 0)} in ${settled} Anteilen. ${formatEuroCents(remainingCents)} bleiben offen.`,
					);
					setReviewOpen(false);
					onSettled();
					return;
				}
				setSettlementMessage(
					settled > 0
						? `${settled} Anteile als beglichen vermerkt${settledCents !== undefined ? `: ${formatEuroCents(settledCents)}` : ''}. Es wurde kein Geld überwiesen.`
						: 'Keine Anteile geändert. Die aktuellen Ausgaben werden neu geladen.',
				);
				onSettled();
				return;
			}
			setError(settlementErrorMessage(res.error));
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
			<Badge variant="secondary" className="tabular-nums">
				{formatEuroCents(debt.cents)}
			</Badge>
			{settlementMessage ? (
				<ItemFooter>
					<Alert>
						<CheckCircle2 />
						<AlertDescription>{settlementMessage}</AlertDescription>
					</Alert>
				</ItemFooter>
			) : (
				canSettle && (
					<ItemFooter className="flex-col items-stretch">
						{records.length > 0 ? (
							<Button
								variant="outline"
								className="min-h-11"
								disabled={settling}
								onClick={() => setReviewOpen(true)}
							>
								Bereits bezahlt? Zahlung verbuchen
							</Button>
						) : (
							<p className="text-sm text-muted-foreground">
								Hier ist kein vollständiger Direktanteil verbuchbar. Prüfe die zugehörigen Ausgaben
								oben.
							</p>
						)}
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
				)
			)}
			{notice && (
				<ItemFooter>
					<Alert>
						<AlertDescription>{notice}</AlertDescription>
					</Alert>
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
						<AlertDialogTitle>Zahlung verbuchen</AlertDialogTitle>
						<AlertDialogDescription>
							{debt.fromName} hat {debt.toName} {formatEuroCents(supportedCents)} bereits bezahlt.
							Nur die unten aufgeführten Direktanteile werden als beglichen vermerkt. Es wird kein
							Geld überwiesen.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ItemGroup aria-label="Unterstützte Ausgabenanteile">
						{records.map((record) => (
							<Item key={record.id} variant="muted" size="xs">
								<ItemContent className="min-w-0">
									<ItemTitle className="line-clamp-none break-words">
										{record.description}
									</ItemTitle>
									<ItemDescription>{formatShortDate(record.occurredAt)}</ItemDescription>
								</ItemContent>
								<Badge variant="outline" className="tabular-nums">
									{formatEuroCents(record.amountCents)}
								</Badge>
							</Item>
						))}
					</ItemGroup>
					{supportedCents < debt.cents && (
						<Alert>
							<AlertDescription>
								{formatEuroCents(debt.cents - supportedCents)} des verrechneten Saldos sind mit
								diesen Anteilen nicht verbuchbar und bleiben offen.
							</AlertDescription>
						</Alert>
					)}
					<p className="text-xs text-muted-foreground">
						Stand der geladenen Ausgaben. Bei zwischenzeitlichen Änderungen zählt das Ergebnis des
						Speicherns.
					</p>
					{notice && (
						<Alert>
							<AlertDescription>{notice}</AlertDescription>
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
						<AlertDialogAction
							className="min-h-11"
							disabled={settling || records.length === 0}
							onClick={() => void settle()}
						>
							{settling && <Spinner data-icon="inline-start" />}
							{formatEuroCents(supportedCents)} verbuchen
						</AlertDialogAction>
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
	onSettled: () => void;
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
				<CardTitle>Offene Zahlungen</CardTitle>
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
							records={settlementRecords(expenses, debt)}
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
