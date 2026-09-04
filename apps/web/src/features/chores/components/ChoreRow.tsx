'use client';

import { ICON_BUTTON } from '@/components/ui/styles';
import { MemberAvatar } from '@/components/wg/MemberAvatar';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { useDismissableMenu } from '@/core/hooks/useDismissableMenu';
import { formatRelativeTime } from '@/core/utils/time';
import { getChoreRepairHint, getChoreStatus } from '@/features/chores/chore-status';
import type { Chore, MemberInfo, RecurrenceType } from '@/features/chores/components/chore-types';
import {
	Check,
	Hand,
	History,
	Loader2,
	MessageSquareMore,
	MoreHorizontal,
	Trash2,
} from 'lucide-react';
import { type ReactElement, memo, useRef, useState } from 'react';

interface ChoreRowProps {
	chore: Chore;
	assignee: MemberInfo;
	isPending: boolean;
	isSwapPending: boolean;
	isCompleteArmed: boolean;
	nextAssigneeName: string | null;
	onCancelComplete: () => void;
	onComplete: (chore: Chore) => void;
	onSwapRequest: (chore: Chore) => void;
	onTakeOver: (chore: Chore) => void;
	onRemove: (id: string) => void;
	highlighted: boolean;
}

const MENU_ITEM =
	'flex h-11 w-full items-center gap-2 px-3 text-left text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] disabled:opacity-50';

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
	nextAssigneeName,
	onCancelComplete,
	onComplete,
	onSwapRequest,
	onTakeOver,
	onRemove,
	highlighted,
}: ChoreRowProps): ReactElement {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const removeConfirm = useConfirmDelete();
	const closeMenu = (): void => {
		setMenuOpen(false);
		removeConfirm.cancel();
	};
	useDismissableMenu({
		open: menuOpen,
		onClose: closeMenu,
		triggerRef: menuTriggerRef,
		menuRef,
	});

	const status = getChoreStatus(chore.nextDueAt);
	// getChoreRepairHint liefert nur noch das Ob, nicht mehr den Text: seine
	// Formulierung war die fünfte Wiederholung desselben Status in einer Karte.
	const needsTakeOver = getChoreRepairHint(chore) !== null;

	return (
		<li
			id={`chore-${chore.id}`}
			className={`group flex flex-wrap min-h-[76px] scroll-mt-24 items-center gap-3 px-3 py-3 sm:px-4 ${
				status.tone === 'overdue' ? 'bg-[var(--danger)]/5' : ''
			} ${status.escalated ? 'border-l-2 border-l-[var(--danger)]' : ''} ${
				highlighted ? 'ring-2 ring-inset ring-[var(--accent)]' : ''
			}`}
		>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="break-words [overflow-wrap:anywhere] text-[15px] font-medium text-[var(--text-1)]">
					{chore.title}
				</div>
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-[var(--text-3)]">
					<MemberAvatar name={assignee.name} color={assignee.color} size={20} />
					<span className="break-words">
						Zuständig: <span>{assignee.name}</span>
					</span>
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
				</div>
				{needsTakeOver && (
					<button
						type="button"
						onClick={() => onTakeOver(chore)}
						disabled={isPending}
						aria-label={`Aufgabe übernehmen: ${chore.title}`}
						className="inline-flex min-h-11 items-center text-[12.5px] font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
					>
						Ich übernehme
					</button>
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

			<div className="flex shrink-0 items-center gap-1.5">
				{/* Nur der Haken bleibt sichtbar — das ist die Aktion, die man an einer
				    Putzaufgabe fast immer will. Tausch anfragen und Entfernen standen
				    vorher gleichrangig daneben, Löschen einen Fingerbreit neben
				    Erledigen. */}
				{!isCompleteArmed && (
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

				<div className="relative shrink-0">
					<button
						ref={menuTriggerRef}
						type="button"
						onClick={() => setMenuOpen((value) => !value)}
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						aria-label={`Aufgabenaktionen: ${chore.title}`}
						className={ICON_BUTTON}
					>
						<MoreHorizontal className="h-4 w-4" aria-hidden />
					</button>
					{menuOpen && (
						<div
							ref={menuRef}
							role="menu"
							aria-label={`Aufgabenaktionen: ${chore.title}`}
							className="absolute right-0 top-11 z-10 min-w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)] py-1 text-[13px] shadow-lg"
						>
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									closeMenu();
									onTakeOver(chore);
								}}
								disabled={isPending}
								aria-label={`Aufgabe übernehmen: ${chore.title}`}
								className={MENU_ITEM}
							>
								<Hand className="h-3.5 w-3.5" aria-hidden />
								Ich übernehme
							</button>
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									closeMenu();
									onSwapRequest(chore);
								}}
								disabled={isPending || isSwapPending}
								aria-label={`Tausch anfragen: ${chore.title}`}
								className={MENU_ITEM}
							>
								{isSwapPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
								) : (
									<MessageSquareMore className="h-3.5 w-3.5" aria-hidden />
								)}
								Tausch anfragen
							</button>
							<span aria-hidden className="my-1 block border-t border-[var(--border)]" />
							<button
								role="menuitem"
								type="button"
								onClick={() => {
									if (!removeConfirm.request(chore.id)) return;
									closeMenu();
									onRemove(chore.id);
								}}
								disabled={isPending}
								aria-label={`${removeConfirm.confirmId === chore.id ? 'Aufgabe entfernen bestätigen' : 'Aufgabe entfernen'}: ${chore.title}`}
								className={`${MENU_ITEM} text-[var(--danger)] hover:bg-[var(--danger)]/5`}
							>
								<Trash2 className="h-3.5 w-3.5" aria-hidden />
								{removeConfirm.confirmId === chore.id ? 'Wirklich entfernen?' : 'Entfernen'}
							</button>
						</div>
					)}
				</div>
			</div>
			{isCompleteArmed && (
				<div className="w-full basis-full space-y-2 border-t border-[var(--border)] pt-3 text-[13px] text-[var(--text-2)]">
					<p>
						{nextAssigneeName
							? `Voraussichtlich als Nächstes: ${nextAssigneeName}.`
							: 'Aktuell ist niemand für die nächste Runde verfügbar.'}
					</p>
					<p>Die Rotation berücksichtigt Aufgaben und Abwesenheiten.</p>
					<p>Der Abschluss bleibt im Verlauf und lässt sich hier nicht zurücknehmen.</p>
					<div className="flex flex-wrap items-center gap-2">
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
							{status.actionLabel} bestätigen
						</button>
						<button
							type="button"
							disabled={isPending}
							onClick={onCancelComplete}
							aria-label={`Erledigen abbrechen: ${chore.title}`}
							className="min-h-11 font-medium text-[var(--text-1)]"
						>
							Abbrechen
						</button>
					</div>
				</div>
			)}
		</li>
	);
});
