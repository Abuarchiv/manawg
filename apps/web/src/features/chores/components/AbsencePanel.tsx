'use client';
import { useConfirmDelete } from '@/core/hooks/useConfirmDelete';
import { type AbsenceInput, formatAbsenceRange } from '@/features/chores/absence';
import type { ChoreMember } from '@/features/chores/components/chore-types';
import { Loader2, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

interface AbsencePanelProps {
	active: boolean;
	absentCount: number;
	members: ChoreMember[];
	memberId: string;
	onMemberIdChange: (value: string) => void;
	start: string;
	onStartChange: (value: string) => void;
	end: string;
	onEndChange: (value: string) => void;
	reason: string;
	onReasonChange: (value: string) => void;
	pending: boolean;
	onAdd: () => void;
	hiddenCount: number;
	totalCount: number;
	allAbsencesHref: string;
	visibleAbsences: AbsenceInput[];
	highlightedAbsenceId: string | null;
	onRemove: (id: string) => void;
	isPending: (key: string) => boolean;
}

export function AbsencePanel({
	active,
	absentCount,
	members,
	memberId,
	onMemberIdChange,
	start,
	onStartChange,
	end,
	onEndChange,
	reason,
	onReasonChange,
	pending,
	onAdd,
	hiddenCount,
	totalCount,
	allAbsencesHref,
	visibleAbsences,
	highlightedAbsenceId,
	onRemove,
	isPending,
}: AbsencePanelProps) {
	// Fünf Eingabefelder für etwas, das man ein paar Mal im Jahr braucht, standen
	// dauerhaft offen mitten auf der Seite. Der Bestand bleibt sichtbar, das
	// Formular kommt auf Anforderung — bzw. sofort, wenn der Deep-Link herführt.
	const [formOpen, setFormOpen] = useState(active);
	const { confirmId, request: requestRemove } = useConfirmDelete();

	return (
		<section
			id="absences-panel"
			className={`rounded-lg border bg-[var(--bg-base)] p-4 ${
				active
					? 'border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-soft)]'
					: 'border-[var(--border)]'
			}`}
		>
			<div className="mb-3 flex items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-[var(--text-1)]">Abwesenheiten</h2>
					<p className="mt-0.5 text-[12px] text-[var(--text-3)]">
						{active
							? 'Abwesenheits-Fokus: wer nicht da ist, wird bei der fairen Rotation übersprungen.'
							: 'Wer nicht da ist, wird bei der fairen Rotation übersprungen.'}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className="rounded-full border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-3)]">
						{absentCount} aktiv
					</span>
					<button
						type="button"
						onClick={() => setFormOpen((value) => !value)}
						aria-expanded={formOpen}
						aria-controls="absence-form"
						aria-label={formOpen ? 'Abwesenheitsformular schließen' : 'Abwesenheit eintragen'}
						className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
					>
						{formOpen ? (
							<X className="h-4 w-4" aria-hidden />
						) : (
							<Plus className="h-4 w-4" aria-hidden />
						)}
					</button>
				</div>
			</div>
			{formOpen && (
				<div id="absence-form">
					<div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
						<select
							value={memberId}
							onChange={(e) => onMemberIdChange(e.target.value)}
							disabled={pending}
							className="h-11 appearance-none rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-1)] transition-colors focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
							aria-label="Abwesendes Mitglied"
						>
							{members.map((member) => (
								<option key={member.id} value={member.id}>
									{member.name}
								</option>
							))}
						</select>
						<input
							type="date"
							value={start}
							onChange={(e) => onStartChange(e.target.value)}
							disabled={pending}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] transition-colors focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
							aria-label="Abwesenheit von"
						/>
						<input
							type="date"
							value={end}
							onChange={(e) => onEndChange(e.target.value)}
							disabled={pending}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] transition-colors focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
							aria-label="Abwesenheit bis"
						/>
					</div>
					<div className="mt-2 flex gap-2">
						<input
							type="text"
							value={reason}
							onChange={(e) => onReasonChange(e.target.value)}
							maxLength={120}
							placeholder="Grund optional"
							aria-label="Abwesenheitsgrund"
							disabled={pending}
							className="h-11 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-1)] transition-colors focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
						/>
						<button
							type="button"
							onClick={onAdd}
							disabled={!start || !end || pending}
							aria-label="Abwesenheit speichern"
							className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--text-1)] px-3 text-[12.5px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{pending ? (
								<>
									<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
									Speichert…
								</>
							) : (
								'Speichern'
							)}
						</button>
					</div>
				</div>
			)}
			{hiddenCount > 0 && (
				<Link
					href={allAbsencesHref}
					className="mt-3 inline-flex h-11 items-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					Alle {totalCount} Abwesenheiten anzeigen
				</Link>
			)}
			{totalCount > 0 && (
				<ul className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
					{visibleAbsences.map((absence) => (
						<li
							key={absence.id}
							id={`absence-${absence.id}`}
							className={`scroll-mt-28 flex items-center justify-between gap-3 px-3 py-2 ${
								absence.id === highlightedAbsenceId
									? 'bg-[var(--accent)]/10 ring-2 ring-inset ring-[var(--accent)]'
									: ''
							}`}
						>
							<div className="min-w-0 text-[13px]">
								<p className="truncate font-medium text-[var(--text-1)]">{absence.memberName}</p>
								<p className="text-[12px] text-[var(--text-3)]">
									{formatAbsenceRange(absence.startDate, absence.endDate)}
									{absence.reason ? ` · ${absence.reason}` : ''}
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									if (requestRemove(absence.id)) onRemove(absence.id);
								}}
								disabled={isPending(`absence:${absence.id}:remove`)}
								aria-label={`Abwesenheit von ${absence.memberName} (${formatAbsenceRange(absence.startDate, absence.endDate)}) ${confirmId === absence.id ? 'endgültig entfernen' : 'entfernen'}`}
								className="h-11 rounded-md px-3 text-[12px] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] focus-visible:ring-offset-2"
							>
								{isPending(`absence:${absence.id}:remove`)
									? '...'
									: confirmId === absence.id
										? 'Wirklich entfernen?'
										: 'Entfernen'}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
