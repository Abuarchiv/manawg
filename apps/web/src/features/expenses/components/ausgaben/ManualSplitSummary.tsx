'use client';

import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { formatEuroCents } from '@/core/utils/money';
import type { Dispatch, SetStateAction } from 'react';

interface ManualSplitSummaryProps {
	amountStr: string;
	manualSplits: Record<string, string>;
	members: ReadonlyArray<{ id: string; name: string }>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
}

export function ManualSplitSummary({
	amountStr,
	manualSplits,
	members,
	setManualSplits,
}: ManualSplitSummaryProps) {
	const totalEuros = parseEuroAmount(amountStr) ?? 0;
	const totalCents = Math.round(totalEuros * CENTS_PER_EURO);
	const splitCents = Object.values(manualSplits).reduce((sum, raw) => {
		const v = parseEuroAmount(raw);
		return v === null ? sum : sum + Math.round(v * CENTS_PER_EURO);
	}, 0);
	const remainderCents = totalCents - splitCents;
	const balanced = totalCents > 0 && remainderCents === 0;
	const tone = balanced
		? 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-fg)]'
		: remainderCents < 0
			? 'border-[var(--danger)]/30 bg-[var(--danger)]/5 text-[var(--danger)]'
			: 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)]';
	const label = balanced
		? '✓ Ausgeglichen'
		: remainderCents < 0
			? `Zu viel: ${formatEuroCents(Math.abs(remainderCents))}`
			: `Offen: ${formatEuroCents(remainderCents)}`;

	function distributeRemainder(): void {
		if (totalCents <= 0 || remainderCents === 0) return;
		const emptyMembers = members.filter((m) => {
			const v = manualSplits[m.id];
			if (!v) return true;
			const n = parseEuroAmount(v);
			return n === null || n === 0;
		});
		const targets = emptyMembers.length > 0 ? emptyMembers : members;
		if (targets.length === 0) return;
		const perCent = Math.floor(remainderCents / targets.length);
		let leftover = remainderCents - perCent * targets.length;
		setManualSplits((prev) => {
			const next = { ...prev };
			for (const t of targets) {
				const curEuros = parseEuroAmount(next[t.id] ?? '') ?? 0;
				const curCents = Math.round(curEuros * CENTS_PER_EURO);
				const addCents = perCent + (leftover > 0 ? 1 : leftover < 0 ? -1 : 0);
				if (leftover > 0) leftover--;
				else if (leftover < 0) leftover++;
				const nextCents = curCents + addCents;
				next[t.id] = formatEuroInput(nextCents / CENTS_PER_EURO);
			}
			return next;
		});
	}

	return (
		<div className="mt-1 space-y-2">
			<div
				aria-live="polite"
				className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-[12.5px] font-medium tabular-nums ${tone}`}
			>
				<span>Summe: {formatEuroCents(splitCents)}</span>
				<span>{label}</span>
			</div>
			{!balanced && totalCents > 0 && (
				<button
					type="button"
					onClick={distributeRemainder}
					className="inline-flex h-11 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					Rest aufteilen
				</button>
			)}
		</div>
	);
}
