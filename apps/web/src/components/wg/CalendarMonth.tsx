'use client';

import type { EventOccurrence } from '@/lib/wg/events';
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
		const cells = gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-day-cell]');
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
			const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-day-cell]');
			if (!btn) return;
			const iso = btn.dataset.dayDate;
			if (!iso) return;
			onSelectDay(new Date(iso));
		},
		[onSelectDay],
	);

	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--bg-base)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color] hover:border-[var(--border-strong)] sm:p-4">
			<header className="mb-3 flex items-center justify-between gap-2">
				<button
					type="button"
					onClick={onPrev}
					aria-label="Vorheriger Monat"
					className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ChevronLeft className="h-4 w-4" aria-hidden />
				</button>
				<h2 className="text-[15px] font-semibold capitalize text-[var(--text-1)]">{monthLabel}</h2>
				<button
					type="button"
					onClick={onNext}
					aria-label="Nächster Monat"
					className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					<ChevronRight className="h-4 w-4" aria-hidden />
				</button>
			</header>
			<div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-[var(--text-3)]">
				{WEEKDAY_LABELS.map((label) => (
					<div key={label}>{label}</div>
				))}
			</div>
			<div
				ref={gridRef}
				// biome-ignore lint/a11y/useSemanticElements: ARIA grid pattern — no semantic HTML element models a date grid with roving-tabindex keyboard navigation
				role="grid"
				aria-label={`Kalender ${monthLabel}`}
				onKeyDown={handleKeyDown}
				onClick={handleGridClick}
				className="mt-1 grid grid-cols-7 gap-1"
			>
				{days.map((day, index) => {
					const isToday = sameDay(day.date, today);
					const isSelected = selectedDay !== null && sameDay(day.date, selectedDay);
					const isFocused = index === focusedIndex;
					const baseClass = day.inCurrentMonth
						? 'text-[var(--text-1)]'
						: 'text-[var(--text-3)] opacity-60';
					return (
						<button
							key={day.date.toISOString()}
							// biome-ignore lint/a11y/useSemanticElements: ARIA grid pattern — gridcell role required for date-grid roving-tabindex keyboard nav; no semantic HTML element models this
							type="button"
							role="gridcell"
							data-day-cell
							data-day-date={day.date.toISOString()}
							tabIndex={isFocused ? 0 : -1}
							aria-label={
								FULL_DATE_FORMATTER.format(day.date) +
								(day.occurrences.length > 0
									? `, ${day.occurrences.length} Termin${day.occurrences.length === 1 ? '' : 'e'}`
									: '')
							}
							aria-current={isToday ? 'date' : undefined}
							aria-selected={isSelected || undefined}
							className={`flex min-h-[48px] flex-col items-stretch gap-1 rounded-md border px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
								isSelected
									? 'border-[var(--accent)] bg-[var(--accent)]/10'
									: isToday
										? 'border-[var(--accent)]/30 ring-1 ring-inset ring-[var(--accent)]/40 hover:bg-[var(--surface)]'
										: 'border-transparent hover:bg-[var(--surface)]'
							}`}
						>
							<span
								className={`text-[12px] ${baseClass} ${
									isToday ? 'font-bold text-[var(--accent)]' : 'font-medium'
								}`}
							>
								{day.date.getDate()}
							</span>
							{day.occurrences.length > 0 && (
								<span className="sr-only">
									{day.occurrences.length} Termin{day.occurrences.length === 1 ? '' : 'e'}:{' '}
									{day.occurrences
										.slice(0, 3)
										.map((occ) => occ.title)
										.join(', ')}
								</span>
							)}
							<ul aria-hidden="true" className="space-y-0.5">
								{day.occurrences.slice(0, 2).map((occ) => (
									<li key={`${occ.eventId}-${occ.occurrenceIndex}`}>
										{/* biome-ignore lint/a11y/useKeyWithClickEvents: decorative preview inside an aria-hidden list — keyboard users select the day via the parent grid button (sr-only summary above lists the events) */}
										<span
											onClick={(e) => {
												e.stopPropagation();
												onSelectOccurrence(occ);
											}}
											className="block w-full truncate rounded-sm bg-[var(--accent)]/15 px-1 py-0.5 text-left text-[11px] font-medium text-[var(--accent)]"
										>
											{occ.title}
										</span>
									</li>
								))}
								{day.occurrences.length > 2 && (
									<li className="text-[10px] text-[var(--text-3)]">
										+{day.occurrences.length - 2} weitere
									</li>
								)}
							</ul>
						</button>
					);
				})}
			</div>
		</section>
	);
}
