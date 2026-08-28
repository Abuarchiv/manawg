'use client';

import { EMPTY_PLACEHOLDER, LIST_CARD } from '@/components/ui/styles';
import { type EventOccurrence, formatEventTimeRange } from '@/lib/wg/events';
import { CalendarClock, Pencil, Sparkles } from 'lucide-react';

interface CalendarUpcomingListProps {
	occurrences: EventOccurrence[];
	choreOccurrences: ReadonlyArray<{
		choreId: string;
		title: string;
		startsAt: string;
	}>;
	onSelect: (occurrence: EventOccurrence) => void;
	wgBaseHref: string;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: '2-digit',
	month: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
});

export function CalendarUpcomingList({
	occurrences,
	choreOccurrences,
	onSelect,
	wgBaseHref,
}: CalendarUpcomingListProps) {
	const hasContent = occurrences.length > 0 || choreOccurrences.length > 0;
	if (!hasContent) {
		return (
			<div className={EMPTY_PLACEHOLDER}>
				Keine Termine in den nächsten 30 Tagen. Tippe auf „Neu“, um etwas anzulegen.
			</div>
		);
	}
	return (
		<ul className={LIST_CARD}>
			{occurrences.map((occ) => (
				<li key={`${occ.eventId}-${occ.occurrenceIndex}`}>
					<div className="flex items-center gap-3 px-3 py-3 sm:px-4">
						<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
							<CalendarClock className="h-4 w-4" aria-hidden />
						</span>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[14.5px] font-medium text-[var(--text-1)]">
								{occ.title}
								{occ.recurring && (
									<span className="ml-2 rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-3)]">
										Wiederholend
									</span>
								)}
							</p>
							<p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
								{formatEventTimeRange(occ)}
								{occ.location ? ` · ${occ.location}` : ''}
							</p>
						</div>
						<button
							type="button"
							onClick={() => onSelect(occ)}
							aria-label={`Termin bearbeiten: ${occ.title}`}
							className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							<Pencil className="h-3.5 w-3.5" aria-hidden />
						</button>
					</div>
				</li>
			))}
			{choreOccurrences.map((chore) => (
				<li key={`chore-${chore.choreId}-${chore.startsAt}`}>
					<a
						href={`${wgBaseHref}/putzen?highlight=${encodeURIComponent(chore.choreId)}`}
						className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] sm:px-4"
					>
						<span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-2)]">
							<Sparkles className="h-4 w-4" aria-hidden />
						</span>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[14.5px] font-medium text-[var(--text-1)]">
								{chore.title}
							</p>
							<p className="mt-0.5 text-[12.5px] text-[var(--text-3)]">
								Putzplan · {DATE_FORMATTER.format(new Date(chore.startsAt))}
							</p>
						</div>
					</a>
				</li>
			))}
		</ul>
	);
}
