'use client';

import { Badge } from '@/components/ui/badge';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	type EventOccurrence,
	eventDateForDisplay,
	formatEventTimeRange,
} from '@/features/events/events';
import { occurrenceToIcs } from '@/features/events/ics';
import { CalendarClock, ChevronRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

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

const ROW_CLASS =
	'flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted';

const DAY_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
});

function formatDayLabel(date: Date, now = new Date()): string {
	const dayMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const diff = Math.round((dayMs - todayMs) / 86_400_000);
	if (diff === 0) return `Heute · ${DAY_FORMATTER.format(date)}`;
	if (diff === 1) return `Morgen · ${DAY_FORMATTER.format(date)}`;
	return DAY_FORMATTER.format(date);
}

export function downloadOccurrenceIcs(occ: EventOccurrence): void {
	const blob = new Blob([occurrenceToIcs(occ)], { type: 'text/calendar;charset=utf-8' });
	const href = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = href;
	a.download = `${occ.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'termin'}.ics`;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	a.remove();
	window.setTimeout(() => window.URL.revokeObjectURL(href), 0);
}

export function CalendarUpcomingList({
	occurrences,
	choreOccurrences,
	onSelect,
	wgBaseHref,
}: CalendarUpcomingListProps) {
	const entries = [
		...occurrences.map((occurrence) => ({
			kind: 'event' as const,
			startsAt: occurrence.startsAt,
			occurrence,
		})),
		...choreOccurrences.map((chore) => ({
			kind: 'chore' as const,
			startsAt: chore.startsAt,
			chore,
		})),
	].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

	if (entries.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CalendarClock aria-hidden />
					</EmptyMedia>
					<EmptyTitle>Die nächsten 30 Tage sind frei</EmptyTitle>
					<EmptyDescription>Trag euren nächsten Termin ein.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const days = new Map<string, { label: string; entries: typeof entries }>();
	for (const entry of entries) {
		const date =
			entry.kind === 'event'
				? eventDateForDisplay(entry.startsAt, entry.occurrence.allDay)
				: new Date(entry.startsAt);
		const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		const day = days.get(key) ?? { label: formatDayLabel(date), entries: [] };
		day.entries.push(entry);
		days.set(key, day);
	}

	return (
		<div className="flex flex-col gap-4">
			{[...days.entries()].map(([key, day]) => (
				<section key={key} aria-label={day.label} className="flex flex-col gap-1">
					<h3 className="pt-1 text-sm font-semibold">{day.label}</h3>
					<ul className="flex flex-col divide-y divide-border/60 rounded-xl border">
						{day.entries.map((entry) =>
							entry.kind === 'chore' ? (
								<li key={`chore-${entry.chore.choreId}-${entry.chore.startsAt}`}>
									<Link
										href={`${wgBaseHref}/putzen?highlight=${encodeURIComponent(entry.chore.choreId)}`}
										aria-label={`Putzaufgabe öffnen: ${entry.chore.title}`}
										className={ROW_CLASS}
									>
										<Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="font-medium break-words">{entry.chore.title}</span>
											<span className="text-sm text-muted-foreground">Putzplan</span>
										</span>
										<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									</Link>
								</li>
							) : (
								<li key={`${entry.occurrence.eventId}-${entry.occurrence.occurrenceIndex}`}>
									<button
										type="button"
										onClick={() => onSelect(entry.occurrence)}
										aria-label={`Termin bearbeiten: ${entry.occurrence.title}`}
										className={ROW_CLASS}
									>
										<CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="font-medium break-words">{entry.occurrence.title}</span>
											<span className="text-sm text-muted-foreground">
												{formatEventTimeRange(entry.occurrence)}
											</span>
											{entry.occurrence.location && (
												<span className="text-sm break-words text-muted-foreground">
													{entry.occurrence.location}
												</span>
											)}
											{entry.occurrence.recurring && (
												<Badge variant="secondary" className="mt-1 w-fit">
													Wiederholend
												</Badge>
											)}
										</span>
										<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									</button>
								</li>
							),
						)}
					</ul>
				</section>
			))}
		</div>
	);
}
