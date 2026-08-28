'use client';

import { DeleteConfirmButton } from '@/components/ui/DeleteConfirmButton';
import { MemberAvatar } from '@/components/wg/dashboard/MemberAvatar';
import { formatRelativeTime } from '@/core/utils/time';
import { getChoreRepairHint, getChoreStatus } from '@/features/chores/chore-status';
import type { Chore, MemberInfo, RecurrenceType } from '@/features/chores/components/chore-types';
import { AlertTriangle, Check, History, Loader2, MessageSquareMore } from 'lucide-react';
import { type ReactElement, memo } from 'react';

interface ChoreRowProps {
	chore: Chore;
	assignee: MemberInfo;
	isPending: boolean;
	isSwapPending: boolean;
	isCompleteArmed: boolean;
	onComplete: (chore: Chore) => void;
	onSwapRequest: (chore: Chore) => void;
	onTakeOver: (chore: Chore) => void;
	onRemove: (id: string) => void;
	highlighted: boolean;
}

function formatChoreCadence(interval: number, type: RecurrenceType): string {
	if (interval <= 0) return 'einmalig';
	if (type === 'months') {
		if (interval === 1) return 'monatlich';
		if (interval === 3) return 'quartalsweise';
		if (interval === 6) return 'halbjährlich';
		if (interval === 12) return 'jährlich';
		return `alle ${interval} Mon.`;
	}
	if (interval === 1) return 'täglich';
	if (interval === 7) return 'wöchentlich';
	if (interval === 14) return 'alle 14 T.';
	return `alle ${interval} T.`;
}

export const ChoreRow = memo(function ChoreRow({
	chore,
	assignee,
	isPending,
	isSwapPending,
	isCompleteArmed,
	onComplete,
	onSwapRequest,
	onTakeOver,
	onRemove,
	highlighted,
}: ChoreRowProps): ReactElement {
	const status = getChoreStatus(chore.nextDueAt);
	const repairHint = getChoreRepairHint(chore);
	const hasAssigneeGaps = chore.openGapCountForAssignee > 0;

	return (
		<li
			id={`chore-${chore.id}`}
			className={`group flex min-h-[76px] scroll-mt-24 items-center gap-3 px-3 py-3 sm:px-4 ${
				status.tone === 'overdue' ? 'bg-[var(--danger)]/5' : ''
			} ${status.escalated ? 'border-l-2 border-l-[var(--danger)]' : ''} ${
				highlighted ? 'ring-2 ring-inset ring-[var(--accent)]' : ''
			}`}
		>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex min-w-0 items-center gap-2">
					<div className="truncate text-[15px] font-medium text-[var(--text-1)]">{chore.title}</div>
					{status.escalationLabel && (
						<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--danger)]/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-[var(--danger)]">
							<AlertTriangle className="h-3 w-3" aria-hidden />
							{status.escalationLabel}
						</span>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-[var(--text-3)]">
					<MemberAvatar name={assignee.name} color={assignee.color} size={20} />
					<span className="truncate">{assignee.name}</span>
					<span aria-hidden>·</span>
					<span
						className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none ${
							status.tone === 'overdue'
								? 'bg-[var(--danger)]/10 text-[var(--danger)]'
								: status.tone === 'soon'
									? 'bg-[var(--accent)]/10 text-[var(--accent)]'
									: 'text-[var(--text-3)]'
						}`}
					>
						{status.label}
					</span>
					<span aria-hidden>·</span>
					<span>{formatChoreCadence(chore.intervalDays, chore.recurrenceType)}</span>
					{hasAssigneeGaps && (
						<>
							<span aria-hidden>·</span>
							<span>
								{chore.openGapCountForAssignee} offene Lücke
								{chore.openGapCountForAssignee === 1 ? '' : 'n'}
							</span>
						</>
					)}
				</div>
				{status.state === 'overdue' && (
					<p className="text-[12.5px] font-medium text-[var(--danger)]">{status.detail}</p>
				)}
				{repairHint && (
					<div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--danger)]/20 bg-[var(--danger)]/5 px-2 py-1.5 text-[12.5px]">
						<span className="font-medium text-[var(--danger)]">{repairHint.title}</span>
						<button
							type="button"
							onClick={() => onTakeOver(chore)}
							disabled={isPending}
							aria-label={`Aufgabe übernehmen: ${chore.title}`}
							className="rounded-sm font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							Ich übernehme
						</button>
					</div>
				)}
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-[var(--text-3)]">
					<History className="h-3.5 w-3.5" aria-hidden />
					{chore.lastCompletedAt && chore.lastCompletedByName ? (
						<span>
							Zuletzt {formatRelativeTime(chore.lastCompletedAt)} von {chore.lastCompletedByName}
						</span>
					) : (
						<span>Noch kein Verlauf</span>
					)}
				</div>
			</div>

			<div
				className={`flex shrink-0 items-center gap-1.5 ${
					status.state === 'overdue' ? 'flex-col sm:flex-row' : ''
				}`}
			>
				{status.state === 'overdue' && (
					<button
						type="button"
						onClick={() => onSwapRequest(chore)}
						disabled={isPending || isSwapPending}
						aria-label={`Tausch anfragen: ${chore.title}`}
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 hover:bg-[var(--surface)] hover:text-[var(--text-1)] disabled:opacity-50"
					>
						{isSwapPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<MessageSquareMore className="h-4 w-4" aria-hidden />
						)}
					</button>
				)}

				{/* Complete button — armed on first tap, commits on second */}
				{isCompleteArmed ? (
					<button
						type="button"
						onClick={() => onComplete(chore)}
						disabled={isPending}
						aria-label={`${status.actionLabel} bestätigen: ${chore.title}`}
						aria-pressed
						className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[var(--text-1)] px-3.5 text-[12px] font-medium text-[var(--bg-base)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						{isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
						) : (
							<Check className="h-3.5 w-3.5" aria-hidden />
						)}
						OK
					</button>
				) : (
					<button
						type="button"
						onClick={() => onComplete(chore)}
						disabled={isPending}
						aria-label={
							status.actionLabel === 'Nachholen'
								? `Überfällige Aufgabe nachholen: ${chore.title}`
								: `Als erledigt markieren: ${chore.title}`
						}
						aria-pressed={false}
						className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--bg-base)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 hover:opacity-90 disabled:opacity-50"
					>
						{isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<Check className="h-4 w-4" aria-hidden />
						)}
					</button>
				)}

				<DeleteConfirmButton
					id={chore.id}
					onConfirm={() => onRemove(chore.id)}
					pending={isPending}
					ariaLabel={`Aufgabe entfernen: ${chore.title}`}
					ariaLabelConfirm={`Aufgabe entfernen bestätigen: ${chore.title}`}
				/>
			</div>
		</li>
	);
});
