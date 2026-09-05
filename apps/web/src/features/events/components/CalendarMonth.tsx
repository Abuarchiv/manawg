'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import { type EventOccurrence, formatEventTimeRange } from '@/features/events/events';
import { cn } from '@/shared/lib/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface CalendarMonthProps {
	month: Date;
	occurrences: EventOccurrence[];
	onPrev: () => void;
	onNext: () => void;
	onSelectDay: (day: Date) => void;
	onSelectOccurrence: (occurrence: EventOccurrence) => void;
	selectedDay: Date | null;
}

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
const MONTH_FORMATTER = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	year: 'numeric',
});

interface DayCell {
	date: Date;
	inCurrentMonth: boolean;
	occurrences: EventOccurrence[];
}

function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeekMonday(date: Date): Date {
	const copy = new Date(date);
	const dow = copy.getDay();
	const diff = dow === 0 ? -6 : 1 - dow;
	copy.setDate(copy.getDate() + diff);
	copy.setHours(0, 0, 0, 0);
	return copy;
}

function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function buildDays(month: Date, occurrences: EventOccurrence[]): DayCell[] {
	const first = startOfMonth(month);
	const last = endOfMonth(month);
	const gridStart = startOfWeekMonday(first);
	const days: DayCell[] = [];
	const cursor = new Date(gridStart);
	while (cursor < last || days.length % 7 !== 0 || days.length === 0) {
		const dayDate = new Date(cursor);
		const dayOcc = occurrences.filter((occ) => sameDay(new Date(occ.startsAt), dayDate));
		days.push({
			date: dayDate,
			inCurrentMonth: dayDate.getMonth() === month.getMonth(),
			occurrences: dayOcc,
		});
		cursor.setDate(cursor.getDate() + 1);
		if (days.length >= 42) break;
	}
	return days;
}

function pickInitialFocusIndex(
	days: DayCell[],
	selectedDay: Date | null,
	today: Date,
	month: Date,
): number {
	if (selectedDay) {
		const idx = days.findIndex((d) => sameDay(d.date, selectedDay));
		if (idx >= 0) return idx;
	}
	if (today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth()) {
		const idx = days.findIndex((d) => sameDay(d.date, today));
		if (idx >= 0) return idx;
	}
	const firstOfMonth = days.findIndex((d) => d.inCurrentMonth);
	return firstOfMonth >= 0 ? firstOfMonth : 0;
}

export function CalendarMonth({
	month,
	occurrences,
	onPrev,
	onNext,
	onSelectDay,
	onSelectOccurrence,
	selectedDay,
}: CalendarMonthProps) {
	const days = useMemo(() => buildDays(month, occurrences), [month, occurrences]);
	const monthLabel = MONTH_FORMATTER.format(month);
	const today = useMemo(() => new Date(), []);

	const [focusedIndex, setFocusedIndex] = useState<number>(() =>
		pickInitialFocusIndex(days, selectedDay, today, month),
	);
	const gridRef = useRef<HTMLDivElement>(null);
	const shouldFocusRef = useRef(false);

	// Reset focus when month changes; only programmatically focus when keyboard moved.
	useEffect(() => {
		setFocusedIndex(pickInitialFocusIndex(days, selectedDay, today, month));
	}, [days, selectedDay, today, month]);

	useEffect(() => {
		if (!shouldFocusRef.current) return;
		shouldFocusRef.current = false;
		const cells = gridRef.current?.querySelectorAll<HTMLElement>('[data-day-cell]');
		cells?.[focusedIndex]?.focus();
	}, [focusedIndex]);

	const move = useCallback(
		(next: number): void => {
			if (next < 0 || next >= days.length) return;
			shouldFocusRef.current = true;
			setFocusedIndex(next);
		},
		[days.length],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>): void => {
			const target = event.target as HTMLElement;
			if (!target.hasAttribute('data-day-cell')) return;
			switch (event.key) {
				case 'ArrowLeft':
					event.preventDefault();
					move(focusedIndex - 1);
					break;
				case 'ArrowRight':
					event.preventDefault();
					move(focusedIndex + 1);
					break;
				case 'ArrowUp':
					event.preventDefault();
					move(focusedIndex - 7);
					break;
				case 'ArrowDown':
					event.preventDefault();
					move(focusedIndex + 7);
					break;
				case 'Home':
					event.preventDefault();
					move(Math.floor(focusedIndex / 7) * 7);
					break;
				case 'End':
					event.preventDefault();
					move(Math.floor(focusedIndex / 7) * 7 + 6);
					break;
				case 'PageUp':
					event.preventDefault();
					onPrev();
					break;
				case 'PageDown':
					event.preventDefault();
					onNext();
					break;
			}
		},
		[focusedIndex, move, onPrev, onNext],
	);

	const handleGridClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-day-cell]');
			if (!cell) return;
			const iso = cell.dataset.dayDate;
			if (!iso) return;
			onSelectDay(new Date(iso));
		},
		[onSelectDay],
	);

	const selectedOccurrences = selectedDay
		? occurrences.filter((occurrence) => sameDay(new Date(occurrence.startsAt), selectedDay))
		: [];
	const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
		days.slice(index * 7, index * 7 + 7),
	);

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<Button
						variant="ghost"
						size="icon"
						className="size-11"
						onClick={onPrev}
						aria-label="Vorheriger Monat"
					>
						<ChevronLeft aria-hidden />
					</Button>
					<CardTitle>{monthLabel}</CardTitle>
					<Button
						variant="ghost"
						size="icon"
						className="size-11"
						onClick={onNext}
						aria-label="Nächster Monat"
					>
						<ChevronRight aria-hidden />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 px-2">
				<div
					ref={gridRef}
					// biome-ignore lint/a11y/useSemanticElements: Calendar uses the existing roving-tabindex grid controller.
					role="grid"
					aria-label={`Kalender ${monthLabel}`}
					onKeyDown={handleKeyDown}
					onClick={handleGridClick}
				>
					<div className="grid grid-cols-7">
						{WEEKDAY_LABELS.map((label) => (
							<div key={label} className="py-2 text-center text-xs text-muted-foreground">
								{label}
							</div>
						))}
					</div>
					{weeks.map((week, weekIndex) => (
						<div key={week[0]?.date.toISOString()} className="grid grid-cols-7">
							{week.map((day, dayIndex) => {
								const isToday = sameDay(day.date, today);
								const isSelected = selectedDay !== null && sameDay(day.date, selectedDay);
								return (
									<div aria-selected={isSelected} key={day.date.toISOString()}>
										<Button
											type="button"
											variant={isSelected ? 'default' : isToday ? 'secondary' : 'ghost'}
											data-day-cell
											data-day-date={day.date.toISOString()}
											tabIndex={weekIndex * 7 + dayIndex === focusedIndex ? 0 : -1}
											aria-label={
												FULL_DATE_FORMATTER.format(day.date) +
												(day.occurrences.length ? `, ${day.occurrences.length} Termine` : '')
											}
											aria-current={isToday ? 'date' : undefined}
											className={cn(
												'relative min-h-11 w-full px-0',
												!day.inCurrentMonth && 'opacity-50',
											)}
										>
											{day.date.getDate()}
											{day.occurrences.length > 0 && (
												<span
													aria-hidden
													className="absolute bottom-1 size-1 rounded-full bg-current"
												/>
											)}
										</Button>
									</div>
								);
							})}
						</div>
					))}
				</div>
				{selectedDay && (
					<section aria-label="Termine am ausgewählten Tag" className="flex flex-col gap-2 px-2">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-sm font-medium">{FULL_DATE_FORMATTER.format(selectedDay)}</h3>
							<Badge variant="secondary">{selectedOccurrences.length} Termine</Badge>
						</div>
						{selectedOccurrences.length === 0 ? (
							<p className="text-sm text-muted-foreground">Keine Termine an diesem Tag.</p>
						) : (
							<ItemGroup>
								{selectedOccurrences.map((occurrence) => (
									<Item
										key={`${occurrence.eventId}-${occurrence.occurrenceIndex}`}
										variant="outline"
									>
										<ItemContent className="min-w-0 basis-32">
											<ItemTitle className="line-clamp-none break-words">
												{occurrence.title}
											</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{formatEventTimeRange(occurrence)}
											</ItemDescription>
										</ItemContent>
										<ItemActions className="ml-auto">
											<Button
												variant="outline"
												onClick={() => onSelectOccurrence(occurrence)}
												aria-label={`Termin öffnen: ${occurrence.title}`}
												className="min-h-11"
											>
												Öffnen
											</Button>
										</ItemActions>
									</Item>
								))}
							</ItemGroup>
						)}
					</section>
				)}
			</CardContent>
		</Card>
	);
}
