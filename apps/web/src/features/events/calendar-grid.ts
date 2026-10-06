import { type EventOccurrence, eventOverlapsCalendarDay } from '@/features/events/events';

/** A chore due date shown in the month grid like an event dot. */
export interface ChoreOccurrence {
	choreId: string;
	title: string;
	startsAt: string;
}

export interface DayCell {
	date: Date;
	inCurrentMonth: boolean;
	occurrences: EventOccurrence[];
	chores: ChoreOccurrence[];
}

export function dayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
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

export function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function buildDays(
	month: Date,
	occurrences: EventOccurrence[],
	choresByDay: Map<string, ChoreOccurrence[]>,
): DayCell[] {
	const first = startOfMonth(month);
	const last = endOfMonth(month);
	const gridStart = startOfWeekMonday(first);
	const days: DayCell[] = [];
	const cursor = new Date(gridStart);
	while (cursor <= last || days.length % 7 !== 0 || days.length === 0) {
		const dayDate = new Date(cursor);
		const dayOcc = occurrences.filter((occ) => eventOverlapsCalendarDay(occ, dayDate));
		days.push({
			date: dayDate,
			inCurrentMonth: dayDate.getMonth() === month.getMonth(),
			occurrences: dayOcc,
			chores: choresByDay.get(dayKey(dayDate)) ?? [],
		});
		cursor.setDate(cursor.getDate() + 1);
		if (days.length >= 42) break;
	}
	return days;
}

export function pickInitialFocusIndex(
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

/** Chore due dates keyed by local calendar day. */
export function groupChoresByDay(
	chores: readonly ChoreOccurrence[],
): Map<string, ChoreOccurrence[]> {
	const choresByDay = new Map<string, ChoreOccurrence[]>();
	for (const chore of chores) {
		const key = dayKey(new Date(chore.startsAt));
		choresByDay.set(key, [...(choresByDay.get(key) ?? []), chore]);
	}
	return choresByDay;
}
