'use client';
import type { ChoreFairness } from '@/features/chores/chore-fairness';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface FairnessPanelProps {
	fairness: ChoreFairness;
}

const FAIRNESS_RULES = [
	'Niemand direkt doppelt',
	'Wenigste Last zuerst',
	'Nach Erledigung neu berechnet',
	'Abwesenheiten überspringen, sobald hinterlegt',
];

// Priorität 3 (Informationsdichte): the rules chips + per-member score grid are
// read-only "leaderboard" detail, not something you act on while working through
// the chore list below — unlike AbsencePanel next to it, which is a form you use
// right away. Collapsed by default keeps the header (insight + next-assignee
// badge) glanceable without pushing the actual chore list further down the
// first paint; same reuse of the ExpenseRow/AnnouncementCard "tap to expand"
// pattern already used elsewhere in this codebase (controlled boolean + button
// + rotating ChevronDown), not a new interaction paradigm.
export function FairnessPanel({ fairness }: FairnessPanelProps) {
	const [expanded, setExpanded] = useState(false);
	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-4">
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				aria-expanded={expanded}
				aria-controls="fairness-panel-details"
				className="flex w-full items-center justify-between gap-3 text-left"
			>
				<div className="min-w-0">
					<h2 className="text-sm font-semibold text-[var(--text-1)]">Faire Rotation</h2>
					<p className="mt-0.5 truncate text-[12px] text-[var(--text-3)]">{fairness.insights[0]}</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{fairness.suggestedAssignee && (
						<span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-medium text-[var(--accent)]">
							Nächste:r: {fairness.suggestedAssignee.name}
						</span>
					)}
					<ChevronDown
						className={`h-4 w-4 text-[var(--text-3)] transition-transform ${
							expanded ? 'rotate-180' : ''
						}`}
						aria-hidden
					/>
				</div>
			</button>
			{expanded && (
				<div id="fairness-panel-details">
					<div className="mb-3 mt-3 flex flex-wrap gap-1.5">
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
				</div>
			)}
		</section>
	);
}
