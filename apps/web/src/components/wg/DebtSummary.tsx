'use client';

import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { PayPalPaymentButton } from '@/components/wg/PayPalPaymentButton';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import type { SettlementSummary, SimplifiedDebt } from '@/features/expenses/debt-reduction';
import { ArrowRight, Bell, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

function settlementErrorMessage(error: string): string {
	if (error === 'settlement_changed')
		return 'Die offenen Beträge haben sich geändert. Prüfe die Zahlung erneut, bevor du sie einträgst.';
	if (error === 'settlement_review_required')
		return 'Prüfe zuerst die betroffenen Ausgaben und den Betrag.';
	if (error === 'paypal_payment_pending')
		return 'Eine PayPal-Zahlung wird gerade verarbeitet. Prüfe ihren Status, bevor du eine Zahlung einträgst.';
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
	expenses: Expense[];
	debt: SimplifiedDebt;
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	memberColor: (id: string) => string | null;
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
	memberColor,
	memberPayPalMerchantId,
	payPalEligible,
	onSettled,
}: DebtRowProps) {
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
			if (res.ok) setPreview(res.data);
			else setError(settlementErrorMessage(res.error));
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
				if (res.error === 'settlement_changed') setPreview(null);
				return;
			}
			const { settled, settledCents, remainingCents, reason } = res.data;
			setPreview(null);
			const message =
				reason === 'no_direct_splits'
					? 'Diese Verrechnung hat keine direkt zuordenbaren Anteile. Prüft die ursprünglichen Ausgaben einzeln.'
					: settled > 0
						? `Zahlung eingetragen: ${formatEuroCents(settledCents ?? 0)} von ${debt.fromName} an ${debt.toName}.${remainingCents ? ` ${formatEuroCents(remainingCents)} bleiben in der Verrechnung offen.` : ''}`
						: 'Keine Zahlung eingetragen. Die offenen Ausgaben werden neu geladen.';
			onSettled(message);
		} finally {
			settlingRef.current = false;
			setSettling(false);
		}
	}

	return (
		<li className="py-3 first:pt-0 last:pb-0">
			<div className="flex flex-wrap items-center gap-2 text-[13px]">
				<MemberAvatar name={debt.fromName} color={memberColor(debt.fromId)} size={20} />
				<span className="break-words font-medium text-[var(--text-1)]">{debt.fromName}</span>
				<ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden />
				<MemberAvatar name={debt.toName} color={memberColor(debt.toId)} size={20} />
				<span className="break-words font-medium text-[var(--text-1)]">{debt.toName}</span>
				<span
					className="ml-auto whitespace-nowrap font-medium tabular-nums text-[var(--danger)]"
					aria-label={`Offen: ${formatEuroCents(debt.cents)}`}
				>
					{formatEuroCents(debt.cents)}
				</span>
			</div>
			{canSettle && (
				<div className="mt-2 space-y-2">
					{canPayWithPayPal && (
						<div>
							<p className="text-[12px] text-[var(--text-2)]">
								Jetzt über PayPal bezahlen: {formatEuroCents(debt.cents)} an {debt.toName}.
							</p>
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
						</div>
					)}
					{!preview && (
						<button
							type="button"
							onClick={() => void review()}
							disabled={reviewing || settling}
							className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text-2)] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
						>
							{reviewing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
							{reviewing ? 'Zahlung wird geprüft…' : 'Bereits erfolgte Zahlung eintragen'}
						</button>
					)}
					{preview && (
						<section
							aria-label="Zahlung prüfen"
							onFocusCapture={(event) => {
								const target = event.target;
								if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
								const bounds = target.getBoundingClientRect();
								const visibleBottom =
									document.querySelector('nav[data-app-chrome]')?.getBoundingClientRect().top ??
									window.innerHeight;
								if (bounds.top < 0 || bounds.bottom > visibleBottom)
									target.scrollIntoView({ block: 'center', behavior: 'instant' });
							}}
							className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px] text-[var(--text-2)]"
						>
							<h3 className="font-medium text-[var(--text-1)]">Zahlung prüfen</h3>
							{preview.splits.length > 0 && (
								<p>
									Bestätige nur, wenn {debt.fromName} {debt.toName} bereits{' '}
									<strong>{formatEuroCents(preview.settleableCents)}</strong> für die folgenden
									Anteile gezahlt hat.
								</p>
							)}
							<p>Hier wird kein Geld überwiesen.</p>
							<ul className="space-y-2">
								{preview.splits.map((split) => (
									<li key={split.id} className="flex items-start justify-between gap-2">
										<Link
											href={`/wg/${encodeURIComponent(shareCode)}/ausgaben?highlight=${encodeURIComponent(split.expenseId)}`}
											className="min-w-0 break-words underline underline-offset-2"
										>
											{expenses.find((expense) => expense.id === split.expenseId)?.description ??
												'Ausgabe ansehen'}
										</Link>
										<span className="shrink-0 tabular-nums">
											{formatEuroCents(split.amountCents)}
										</span>
									</li>
								))}
							</ul>
							{preview.remainingCents > 0 && (
								<p>
									Von {formatEuroCents(preview.netCents)} verrechnetem Saldo bleiben{' '}
									{formatEuroCents(preview.remainingCents)} offen. Hier lassen sich nur die
									aufgeführten vollständigen Anteile verbuchen; prüft den Rest in den ursprünglichen
									Ausgaben.
								</p>
							)}
							{preview.splits.length === 0 && (
								<p>
									Keine direkt zuordenbaren Anteile. Es wird keine Zahlung eingetragen. Prüft die
									ursprünglichen Ausgaben einzeln.
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => setPreview(null)}
									disabled={settling}
									className="min-h-11 rounded-md px-3 text-[13px] disabled:opacity-50"
								>
									Abbrechen
								</button>
								{preview.settleableCents > 0 && (
									<button
										type="button"
										onClick={() => void settle()}
										disabled={settling}
										className="btn-app-primary min-h-11 px-3 py-2 text-[13px] disabled:opacity-50"
									>
										{settling
											? 'Speichert…'
											: `${formatEuroCents(preview.settleableCents)} als bezahlt eintragen`}
									</button>
								)}
							</div>
						</section>
					)}
				</div>
			)}
			{error && (
				<p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">
					{error}
				</p>
			)}
		</li>
	);
}

interface DebtSummaryProps {
	expenses: Expense[];
	debts: SimplifiedDebt[];
	summary?: SettlementSummary;
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	memberColor: (id: string) => string | null;
	memberPayPalMerchantId?: (id: string) => string | null;
	onSettled: (message?: string) => void;
}

export function DebtSummary({
	expenses,
	debts,
	summary,
	shareCode,
	currentMemberId,
	memberToken,
	memberColor,
	memberPayPalMerchantId = () => null,
	onSettled,
}: DebtSummaryProps) {
	if (debts.length === 0) return null;

	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color] hover:border-[var(--border-strong)]">
			<div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
				<h2 className="text-[13px] font-medium text-[var(--text-2)]">Offene Zahlungen</h2>
				<Link
					href={`/wg/${encodeURIComponent(shareCode)}/mahnungen`}
					className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[11.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<Bell className="h-3.5 w-3.5" aria-hidden />
					Mahnen
				</Link>
			</div>
			{summary && summary.savedTransfers > 0 && (
				<div className="border-b border-[var(--border)] bg-[var(--accent)]/5 px-4 py-3 text-[12.5px] text-[var(--text-2)]">
					<p className="font-medium text-[var(--text-1)]">
						Minimaler Ausgleich: {summary.simplifiedCount} statt {summary.directCount} Überweisung
						{summary.directCount === 1 ? '' : 'en'}
					</p>
					<p className="mt-0.5 text-[var(--text-3)]">
						Spart {summary.savedTransfers} Zahlung{summary.savedTransfers === 1 ? '' : 'en'}.
					</p>
				</div>
			)}
			<ul className="divide-y divide-[var(--border)] px-4">
				{(summary?.simplified.length ? summary.simplified : debts).map((d) => (
					<DebtRow
						key={`${d.fromId}-${d.toId}`}
						debt={d}
						expenses={expenses}
						shareCode={shareCode}
						currentMemberId={currentMemberId}
						memberToken={memberToken}
						memberColor={memberColor}
						memberPayPalMerchantId={memberPayPalMerchantId}
						payPalEligible={
							summary === undefined ||
							debts.some(
								(direct) =>
									direct.fromId === d.fromId && direct.toId === d.toId && direct.cents >= d.cents,
							)
						}
						onSettled={onSettled}
					/>
				))}
			</ul>
		</section>
	);
}
