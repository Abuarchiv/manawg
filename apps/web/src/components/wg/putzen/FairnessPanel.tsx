'use client';
import type { ChoreFairness } from '@/lib/wg/chore-fairness';

interface FairnessPanelProps {
	fairness: ChoreFairness;
}

const FAIRNESS_RULES = [
	'Niemand direkt doppelt',
	'Wenigste Last zuerst',
	'Nach Erledigung neu berechnet',
	'Abwesenheiten überspringen, sobald hinterlegt',
];

export function FairnessPanel({ fairness }: FairnessPanelProps) {
	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-[var(--text-1)]">Faire Rotation</h2>
					<p className="mt-0.5 text-[12px] text-[var(--text-3)]">{fairness.insights[0]}</p>
				</div>
				{fairness.suggestedAssignee && (
					<span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--accent)]">
						Nächste:r: {fairness.suggestedAssignee.name}
					</span>
				)}
			</div>
			<div className="mb-3 flex flex-wrap gap-1.5">
				{FAIRNESS_RULES.map((rule) => (
					<span
						key={rule}
						className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11.5px] text-[var(--text-2)]"
					>
						{rule}
					</span>
				))}
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				{fairness.rows.map((row) => (
					<div key={row.id} className="rounded-md border border-[var(--border)] px-3 py-2">
						<div className="flex items-center justify-between gap-2">
							<span className="truncate text-[13px] font-medium text-[var(--text-1)]">
								{row.name}
							</span>
							<span className="text-[12px] tabular-nums text-[var(--text-3)]">
								{row.assignedCount} Aufgabe{row.assignedCount === 1 ? '' : 'n'}
							</span>
						</div>
						<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
							{row.openGapCount} Lücke{row.openGapCount === 1 ? '' : 'n'} · Score {row.score}
							{!row.available ? ' · abwesend' : ''}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}
