'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from '@/components/ui/item';
import { type EventOccurrence, formatEventTimeRange } from '@/features/events/events';
import { occurrenceToIcs } from '@/features/events/ics';
import { CalendarClock, CalendarPlus, Pencil, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface CalendarUpcomingListProps {
	occurrences: EventOccurrence[];
	choreOccurrences: ReadonlyArray<{
		choreId: string;
		title: string;
		startsAt: string;
	}>;
	onSelect: (occurrence: EventOccurrence) => void;
	onCreate: () => void;
	wgBaseHref: string;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'short',
	day: '2-digit',
	month: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
});

function downloadOccurrenceIcs(occ: EventOccurrence): void {
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
	onCreate,
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
				<EmptyContent>
					<Button type="button" onClick={onCreate} className="min-h-11">
						<CalendarPlus data-icon="inline-start" aria-hidden />
						Termin hinzufügen
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<ItemGroup aria-label="Anstehende Termine und Putzaufgaben">
			{entries.map((entry) => {
				if (entry.kind === 'chore') {
					const chore = entry.chore;
					return (
						<Item key={`chore-${chore.choreId}-${chore.startsAt}`} variant="outline">
							<ItemMedia variant="icon">
								<Sparkles aria-hidden />
							</ItemMedia>
							<ItemContent className="min-w-0 basis-32">
								<ItemTitle className="line-clamp-none break-words">{chore.title}</ItemTitle>
								<ItemDescription className="line-clamp-none">
									Putzplan · {DATE_FORMATTER.format(new Date(chore.startsAt))}
								</ItemDescription>
							</ItemContent>
							<ItemActions className="ml-auto">
								<Button
									nativeButton={false}
									render={
										<Link
											href={`${wgBaseHref}/putzen?highlight=${encodeURIComponent(chore.choreId)}`}
										/>
									}
									variant="outline"
									className="min-h-11"
									aria-label={`Putzaufgabe öffnen: ${chore.title}`}
								>
									Öffnen
								</Button>
							</ItemActions>
						</Item>
					);
				}
				const occurrence = entry.occurrence;
				return (
					<Item key={`${occurrence.eventId}-${occurrence.occurrenceIndex}`} variant="outline">
						<ItemMedia variant="icon">
							<CalendarClock aria-hidden />
						</ItemMedia>
						<ItemContent className="min-w-0 basis-40">
							<ItemTitle className="line-clamp-none break-words">{occurrence.title}</ItemTitle>
							<ItemDescription className="line-clamp-none">
								{formatEventTimeRange(occurrence)}
							</ItemDescription>
							{occurrence.location && (
								<ItemDescription className="line-clamp-none break-words">
									{occurrence.location}
								</ItemDescription>
							)}
							{occurrence.recurring && (
								<Badge variant="secondary" className="w-fit">
									Wiederholend
								</Badge>
							)}
						</ItemContent>
						<ItemActions className="ml-auto">
							<Button
								variant="ghost"
								size="icon"
								onClick={() => downloadOccurrenceIcs(occurrence)}
								aria-label={`Zum Kalender hinzufügen: ${occurrence.title}`}
								className="size-11"
							>
								<CalendarPlus aria-hidden />
							</Button>
							<Button
								variant="outline"
								onClick={() => onSelect(occurrence)}
								aria-label={`Termin bearbeiten: ${occurrence.title}`}
								className="min-h-11"
							>
								<Pencil data-icon="inline-start" aria-hidden />
								Bearbeiten
							</Button>
						</ItemActions>
					</Item>
				);
			})}
		</ItemGroup>
	);
}
