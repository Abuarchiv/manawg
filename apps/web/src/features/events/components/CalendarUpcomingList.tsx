'use client';

import { CalendarClock, ChevronRight, Repeat, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { MS_PER_DAY } from '@/core/utils/time';
import { CALENDAR_ROW_CLASS } from '@/features/events/components/calendar-row';
import { isSameDay } from '@/features/events/event-display';
import {
	type EventOccurrence,
	eventDateForDisplay,
	formatEventTimeOfDay,
	formatEventTimeRange,
	parseRecurrenceRule,
	RECURRENCE_OPTIONS,
} from '@/features/events/events';
import { occurrenceToIcs } from '@/features/events/ics';
import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';
import { type Message, useMessage } from '@/shared/i18n/message';
import { cn } from '@/shared/lib/cn';

interface CalendarUpcomingListProps {
	occurrences: EventOccurrence[];
	choreOccurrences: ReadonlyArray<{
		choreId: string;
		title: string;
		startsAt: string;
	}>;
	onSelect: (occurrence: EventOccurrence) => void;
	wgBaseHref: string;
	/** Rule per event (eventId); it yields the interval behind the time. */
	recurrenceByEventId?: ReadonlyMap<string, string | null>;
	/** Event from the push link (`?highlight=`); its next occurrence is marked and scrolled to. */
	highlightEventId?: string | null;
}

const ROW_CLASS = cn(CALENDAR_ROW_CLASS, 'pr-3 pl-1');

type Translate = ReturnType<typeof useTranslations<'events'>>;

/** Short interval like "wöchentlich"; more complex rules are labeled generically as "wiederkehrend". */
function recurrenceLabel(
	rule: string | null | undefined,
	t: Translate,
	render: (message: Message) => string,
): string {
	const parsed = parseRecurrenceRule(rule);
	const simple = parsed && parsed.interval === 1 && parsed.byDay === undefined;
	const option = simple ? RECURRENCE_OPTIONS.find((o) => o.value === parsed.freq) : undefined;
	return option ? render(option.label).toLowerCase() : t('agenda.recurring');
}

function formatDayLabel(date: Date, t: Translate, locale: Locale, now = new Date()): string {
	const dayMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const diff = Math.round((dayMs - todayMs) / MS_PER_DAY);
	const day = dateTimeFormat(locale, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
	}).format(date);
	if (diff === 0) return t('agenda.dayToday', { date: day });
	if (diff === 1) return t('agenda.dayTomorrow', { date: day });
	return day;
}

/** Time of day; a timed span that began before today names its start day too. */
function timeLabel(occurrence: EventOccurrence, todayStart: Date, locale: Locale): Message {
	return !occurrence.allDay && new Date(occurrence.startsAt) < todayStart
		? formatEventTimeRange(occurrence, locale)
		: formatEventTimeOfDay(occurrence, locale);
}

export function downloadOccurrenceIcs(occ: EventOccurrence): void {
	const blob = new Blob([occurrenceToIcs(occ)], { type: 'text/calendar;charset=utf-8' });
	const href = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = href;
	a.download = `${occ.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'event'}.ics`;
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
	recurrenceByEventId,
	highlightEventId = null,
}: CalendarUpcomingListProps) {
	const t = useTranslations('events');
	const render = useMessage();
	const locale = useLocale() as Locale;
	const weekdayFormat = dateTimeFormat(locale, { weekday: 'short' });
	const monthFormat = dateTimeFormat(locale, { month: 'short' });
	useEffect(() => {
		if (!highlightEventId) return;
		document.getElementById(`event-${highlightEventId}`)?.scrollIntoView({ block: 'center' });
	}, [highlightEventId]);

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
					<EmptyTitle>{t('agenda.emptyTitle')}</EmptyTitle>
					<EmptyDescription>{t('agenda.emptyBody')}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	// For series, only the first occurrence carries the anchor.
	const highlightedEntry = highlightEventId
		? entries.find(
				(entry) => entry.kind === 'event' && entry.occurrence.eventId === highlightEventId,
			)
		: undefined;
	const days = new Map<string, { label: string; date: Date; entries: typeof entries }>();
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	for (const entry of entries) {
		const startDate =
			entry.kind === 'event'
				? eventDateForDisplay(entry.startsAt, entry.occurrence.allDay)
				: new Date(entry.startsAt);
		// A span that began before today is still running: list it under today, not under a past day.
		const date = startDate < todayStart ? todayStart : startDate;
		const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		const day = days.get(key) ?? { label: formatDayLabel(date, t, locale), date, entries: [] };
		day.entries.push(entry);
		days.set(key, day);
	}

	// One list, date on the left: days can be skimmed like in a pocket calendar.
	return (
		<ul className="flex flex-col divide-y overflow-hidden rounded-xl border">
			{[...days.entries()].map(([key, day], index, all) => {
				const prevDate = index > 0 ? all[index - 1]?.[1].date : undefined;
				const showMonth = !prevDate || prevDate.getMonth() !== day.date.getMonth();
				const isToday = isSameDay(day.date, now);
				return (
					<li key={key} className="grid grid-cols-[3.25rem_minmax(0,1fr)]">
						<h3
							className={cn(
								'flex flex-col items-center py-2 leading-tight',
								isToday ? 'text-foreground' : 'text-muted-foreground',
							)}
						>
							<span className="sr-only">{day.label}</span>
							<span aria-hidden className="text-meta">
								{isToday ? t('agenda.todayShort') : weekdayFormat.format(day.date).replace('.', '')}
							</span>
							<span aria-hidden className="flex items-baseline gap-0.5">
								<span className="text-base font-semibold tabular-nums">{day.date.getDate()}</span>
								{showMonth && (
									<span className="text-meta font-normal">
										{monthFormat.format(day.date).replace('.', '')}
									</span>
								)}
							</span>
						</h3>
						<ul aria-label={day.label} className="flex min-w-0 flex-col divide-y divide-border/60">
							{day.entries.map((entry) =>
								entry.kind === 'chore' ? (
									<li key={`chore-${entry.chore.choreId}-${entry.chore.startsAt}`}>
										<Link
											href={`${wgBaseHref}/chores?highlight=${encodeURIComponent(entry.chore.choreId)}`}
											aria-label={t('agenda.openChore', { title: entry.chore.title })}
											className={ROW_CLASS}
										>
											<span className="flex min-w-0 flex-1 flex-col">
												<span className="text-body font-medium break-words">
													{entry.chore.title}
												</span>
												<span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
													<Sparkles className="size-4 shrink-0" aria-hidden />
													{t('agenda.choreBadge')}
												</span>
											</span>
											<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										</Link>
									</li>
								) : (
									<li
										key={`${entry.occurrence.eventId}-${entry.occurrence.occurrenceIndex}`}
										id={
											entry === highlightedEntry ? `event-${entry.occurrence.eventId}` : undefined
										}
										className={cn(
											'scroll-mt-24',
											entry === highlightedEntry && 'ring-2 ring-inset ring-ring',
										)}
									>
										<button
											type="button"
											onClick={() => onSelect(entry.occurrence)}
											aria-label={t('agenda.openEvent', { title: entry.occurrence.title })}
											className={ROW_CLASS}
										>
											<span className="flex min-w-0 flex-1 flex-col">
												<span className="text-body font-medium break-words">
													{entry.occurrence.title}
												</span>
												<span className="text-meta break-words text-muted-foreground">
													<CalendarClock className="mr-1 inline size-4 align-[-2px]" aria-hidden />
													{render(timeLabel(entry.occurrence, todayStart, locale))}
													{entry.occurrence.location && ` · ${entry.occurrence.location}`}
													{entry.occurrence.recurring && (
														<>
															{' · '}
															<span className="whitespace-nowrap">
																<Repeat className="mr-0.5 inline size-3 align-[-1px]" aria-hidden />
																{recurrenceLabel(
																	recurrenceByEventId?.get(entry.occurrence.eventId),
																	t,
																	render,
																)}
															</span>
														</>
													)}
												</span>
											</span>
											<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										</button>
									</li>
								),
							)}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}
