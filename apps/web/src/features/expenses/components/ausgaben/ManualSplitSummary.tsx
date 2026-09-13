'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatEuroInput, parseEuroAmount } from '@/core/utils/amount';
import { CENTS_PER_EURO } from '@/core/utils/money';
import { formatEuroCents } from '@/core/utils/money';
import type { Dispatch, SetStateAction } from 'react';

interface ManualSplitSummaryProps {
	amountStr: string;
	manualSplits: Record<string, string>;
	members: ReadonlyArray<{ id: string; name: string }>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
	disabled?: boolean;
}

export function ManualSplitSummary({
	amountStr,
	manualSplits,
	members,
	setManualSplits,
	disabled = false,
}: ManualSplitSummaryProps) {
	const totalEuros = parseEuroAmount(amountStr) ?? 0;
	const totalCents = Math.round(totalEuros * CENTS_PER_EURO);
	const splitCents = Object.values(manualSplits).reduce((sum, raw) => {
		const v = parseEuroAmount(raw);
		return v === null ? sum : sum + Math.round(v * CENTS_PER_EURO);
	}, 0);
	const remainderCents = totalCents - splitCents;
	const balanced = totalCents > 0 && remainderCents === 0;
	const label = balanced ? '✓ Ausgeglichen' : remainderCents < 0 ? 'Zu viel' : 'Offen';

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
		<div className="flex flex-col gap-2">
			<Alert
				aria-live="polite"
				variant={balanced ? undefined : remainderCents < 0 ? 'destructive' : undefined}
			>
				<AlertDescription className="flex items-center justify-between gap-2">
					<span>
						Summe: <span className="font-mono tabular-nums">{formatEuroCents(splitCents)}</span>
					</span>
					<span>
						{label}
						{!balanced && (
							<>
								:{' '}
								<span className="font-mono tabular-nums">
									{formatEuroCents(Math.abs(remainderCents))}
								</span>
							</>
						)}
					</span>
				</AlertDescription>
			</Alert>
			{!balanced && totalCents > 0 && (
				<Button
					type="button"
					variant="outline"
					size="lg"
					onClick={distributeRemainder}
					disabled={disabled}
					className="min-h-11"
				>
					Rest aufteilen
				</Button>
			)}
		</div>
	);
}
