'use client';
import { type ChoreAssigneeMember, getChoreRepairHint } from '@/features/chores/chore-status';
import type { Chore } from '@/features/chores/components/chore-types';
import Link from 'next/link';

interface ChoreRepairFocusProps {
	repairCount: number;
	overdueFilterActive: boolean;
	hiddenRepairCount: number;
	allRepairsHref: string;
	items: Chore[];
	suggestedAssignee: ChoreAssigneeMember | null;
	onAssignTo: (chore: Chore, memberId: string, notice: string) => void;
	onTakeOver: (chore: Chore) => void;
	onComplete: (chore: Chore) => void;
	isPending: (key: string) => boolean;
}

export function ChoreRepairFocus({
	repairCount,
	overdueFilterActive,
	hiddenRepairCount,
	allRepairsHref,
	items,
	suggestedAssignee,
	onAssignTo,
	onTakeOver,
	onComplete,
	isPending,
}: ChoreRepairFocusProps) {
	return (
		<section
			id="chore-repair-focus"
			className={`rounded-lg border p-4 ${
				overdueFilterActive
					? 'border-[var(--danger)] ring-2 ring-[var(--danger)]/20'
					: 'border-[var(--danger)]/25'
			} bg-[var(--danger)]/5`}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<div>
					<h2 className="text-sm font-semibold text-[var(--text-1)]">Lücken reparieren</h2>
					{overdueFilterActive && (
						<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
							Putzlücken-Fokus: überfällige Aufgaben kannst du hier direkt übernehmen oder
							erledigen.
						</p>
					)}
				</div>
				<span className="rounded-full bg-[var(--danger)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]">
					{repairCount}
				</span>
			</div>
			{hiddenRepairCount > 0 && (
				<Link
					href={allRepairsHref}
					className="mb-3 inline-flex h-11 items-center rounded-md border border-[var(--danger)]/25 bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--danger)] transition-colors hover:border-[var(--danger)]/40 hover:bg-[var(--danger)]/10"
				>
					Alle {repairCount} Putzlücken anzeigen
				</Link>
			)}
			{repairCount === 0 ? (
				<div className="rounded-md border border-dashed border-[var(--danger)]/25 bg-[var(--bg-base)] px-3 py-4 text-[13px] text-[var(--text-3)]">
					Aktuell gibt es keine überfälligen Putzlücken.
				</div>
			) : (
				<ul className="space-y-2">
					{items.map((item) => {
						const hint = getChoreRepairHint(item);
						if (!hint) return null;
						return (
							<li
								key={item.id}
								className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
							>
								<div className="min-w-0">
									<p className="truncate text-[13px] font-medium text-[var(--text-1)]">
										{item.title}
									</p>
									<p className="text-[12px] text-[var(--text-3)]">{hint.title}</p>
								</div>
								<div className="flex flex-wrap gap-1 sm:shrink-0 sm:flex-nowrap">
									{suggestedAssignee && item.assignedMemberId !== suggestedAssignee.id && (
										<button
											type="button"
											onClick={() =>
												onAssignTo(
													item,
													suggestedAssignee.id,
													`${suggestedAssignee.name} ist jetzt fair vorgeschlagen eingetragen.`,
												)
											}
											disabled={isPending(`${item.id}:take`)}
											aria-label={`Aufgabe ${suggestedAssignee.name} zuweisen: ${item.title}`}
											className="h-11 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 text-[12px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
										>
											{suggestedAssignee.name}
										</button>
									)}
									<button
										type="button"
										onClick={() => onTakeOver(item)}
										disabled={isPending(`${item.id}:take`)}
										aria-label={`Aufgabe selbst übernehmen: ${item.title}`}
										className="h-11 rounded-md bg-[var(--text-1)] px-3 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
									>
										Ich
									</button>
									<button
										type="button"
										onClick={() => onComplete(item)}
										disabled={isPending(item.id)}
										aria-label={`Aufgabe erledigen: ${item.title}`}
										className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
									>
										Erledigt
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
