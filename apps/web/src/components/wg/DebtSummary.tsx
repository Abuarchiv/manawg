'use client';

import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import type { SettlementSummary, SimplifiedDebt } from '@/lib/wg/debt-reduction';
import { ArrowRight, Bell, Check, CheckCircle2, Loader2 } from 'lucide-react';
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
	return 'Ausgleich konnte nicht gespeichert werden.';
}

interface DebtRowProps {
	debt: SimplifiedDebt;
	shareCode: string;
	currentMemberId: string;
	memberColor: (id: string) => string | null;
	onSettled: () => void;
}

interface SettleBatchResponse {
	settled: number;
	settledCents?: number;
	remainingCents?: number;
	reason?: string;
}

function DebtRow({ debt, shareCode, currentMemberId, memberColor, onSettled }: DebtRowProps) {
	const [settling, setSettling] = useState(false);
	const [settlementMessage, setSettlementMessage] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const settlingRef = useRef(false);
	const canSettle = debt.fromId === currentMemberId || debt.toId === currentMemberId;

	async function settle(): Promise<void> {
		if (settlingRef.current) return;
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
						`${formatEuroCents(remainingCents ?? debt.cents)} zwischen ${debt.fromName} und ${debt.toName} sind über andere Mitglieder verrechnet. Begleicht dafür die zugehörigen Ausgaben direkt.`,
					);
					return;
				}
				if (settled > 0 && remainingCents && remainingCents > 0) {
					setNotice(
						`Teilweise beglichen: ${formatEuroCents(settledCents ?? 0)} gespeichert, ${formatEuroCents(remainingCents)} sind über andere Mitglieder verrechnet.`,
					);
					onSettled();
					return;
				}
				setSettlementMessage(
					settled > 0
						? `Ausgleich gespeichert: ${debt.fromName} hat ${debt.toName} ${formatEuroCents(settledCents ?? debt.cents)} bezahlt.`
						: `Kein offener Ausgleich mehr: ${debt.fromName} und ${debt.toName} sind bereits ausgeglichen.`,
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

	if (settlementMessage) {
		return (
			<li className="py-3 first:pt-0 last:pb-0">
				<output
					className="flex items-center gap-1.5 text-[12.5px] text-[var(--success)]"
					aria-live="polite"
					aria-atomic="true"
				>
					<CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
					<span>{settlementMessage}</span>
				</output>
			</li>
		);
	}

	return (
		<li className="py-3 first:pt-0 last:pb-0">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
				<div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto_auto_minmax(0,1fr)_auto] items-center gap-2 text-[13.5px]">
					<MemberAvatar name={debt.fromName} color={memberColor(debt.fromId)} size={20} />
					<span className="truncate font-medium text-[var(--text-1)]">{debt.fromName}</span>
					<ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden />
					<MemberAvatar name={debt.toName} color={memberColor(debt.toId)} size={20} />
					<span className="truncate font-medium text-[var(--text-1)]">{debt.toName}</span>
					<span
						className="shrink-0 whitespace-nowrap tabular-nums text-[var(--danger)]"
						aria-label={`Offen: ${formatEuroCents(debt.cents)}`}
					>
						<span aria-hidden="true">−</span>
						{formatEuroCents(debt.cents)}
					</span>
				</div>
				{canSettle && (
					<button
						type="button"
						onClick={() => void settle()}
						disabled={settling}
						aria-label={`${debt.fromName} hat ${debt.toName} ${formatEuroCents(debt.cents)} bezahlt`}
						className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
					>
						{settling ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<Check className="h-3.5 w-3.5" aria-hidden />
						)}
						Beglichen
					</button>
				)}
			</div>
			{notice ? (
				<output aria-live="polite" className="mt-2 block text-[12px] text-[var(--text-2)]">
					{notice}
				</output>
			) : null}
			{error ? (
				<p role="alert" className="mt-2 text-[12px] text-[var(--danger)]">
					{error}
				</p>
			) : null}
		</li>
	);
}

interface DebtSummaryProps {
	debts: SimplifiedDebt[];
	summary?: SettlementSummary;
	shareCode: string;
	currentMemberId: string;
	memberColor: (id: string) => string | null;
	onSettled: () => void;
}

export function DebtSummary({
	debts,
	summary,
	shareCode,
	currentMemberId,
	memberColor,
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
						shareCode={shareCode}
						currentMemberId={currentMemberId}
						memberColor={memberColor}
						onSettled={onSettled}
					/>
				))}
			</ul>
		</section>
	);
}
