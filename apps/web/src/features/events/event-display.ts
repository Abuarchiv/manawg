import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';
import {
	DEFAULT_DURATION_MS,
	durationMsFor,
	type EventInput,
	type EventOccurrence,
	expandRecurrence,
} from './event-recurrence';

/** Browser agenda: all-day events occupy inclusive local calendar dates, not one hour. */
export function expandAgendaRecurrence(event: EventInput, from: Date, to: Date): EventOccurrence[] {
	if (!event.allDay) return expandRecurrence(event, from, to);
	if (from.getTime() > to.getTime()) return [];
	// Widen candidate selection for UTC dates, legacy local instants and ongoing spans.
	const start = getCalendarDayBounds(from).start;
	start.setTime(start.getTime() - durationMsFor(event, Date.parse(event.startsAt)));
	return expandRecurrence(event, start, getCalendarDayBounds(to).end).filter((occurrence) => {
		const first = eventDateForDisplay(occurrence.startsAt, true);
		first.setHours(0, 0, 0, 0);
		const endExclusive = eventDateForDisplay(occurrence.endsAt ?? occurrence.startsAt, true);
		endExclusive.setHours(0, 0, 0, 0);
		endExclusive.setDate(endExclusive.getDate() + 1);
		return first.getTime() <= to.getTime() && endExclusive.getTime() > from.getTime();
	});
}

/** Weekday, date and time formatters of one locale; German keeps the numeric day and month. */
function formatters(locale: Locale) {
	const dateOptions: Intl.DateTimeFormatOptions =
		locale === 'de' ? { day: '2-digit', month: '2-digit' } : { day: 'numeric', month: 'short' };
	const fullDateOptions: Intl.DateTimeFormatOptions =
		locale === 'de'
			? { day: '2-digit', month: '2-digit', year: 'numeric' }
			: { day: 'numeric', month: 'short', year: 'numeric' };
	return {
		weekday: dateTimeFormat(locale, { weekday: 'short' }),
		allDayWeekday: dateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
		date: dateTimeFormat(locale, dateOptions),
		dateFull: dateTimeFormat(locale, { ...fullDateOptions, timeZone: 'UTC' }),
		time: dateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
	};
}

function plain(text: string): Message {
	return { key: 'events.time.plain', values: { text } };
}

export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

export function formatEventTimeRange(occurrence: EventOccurrence, locale: Locale = 'de'): Message {
	const f = formatters(locale);
	const start = new Date(occurrence.startsAt);
	if (occurrence.allDay) {
		const display = eventDateForDisplay(occurrence.startsAt, true);
		const date = new Date(Date.UTC(display.getFullYear(), display.getMonth(), display.getDate()));
		return {
			key: 'events.time.allDayDate',
			values: { weekday: f.allDayWeekday.format(date), date: f.dateFull.format(date) },
		};
	}
	const end = occurrence.endsAt ? new Date(occurrence.endsAt) : null;
	const startLabel = `${f.weekday.format(start)} ${f.date.format(start)} ${f.time.format(start)}`;
	if (!end) return plain(startLabel);
	if (isSameDay(start, end)) {
		return plain(`${startLabel}–${f.time.format(end)}`);
	}
	return plain(
		`${startLabel} – ${f.weekday.format(end)} ${f.date.format(end)} ${f.time.format(end)}`,
	);
}

/** Time only, for lists that already show the day alongside. */
export function formatEventTimeOfDay(occurrence: EventOccurrence, locale: Locale = 'de'): Message {
	const f = formatters(locale);
	if (occurrence.allDay) {
		// A multi-day all-day span would otherwise show only its first day.
		const first = eventDateForDisplay(occurrence.startsAt, true);
		const last = eventDateForDisplay(occurrence.endsAt ?? occurrence.startsAt, true);
		first.setHours(0, 0, 0, 0);
		last.setHours(0, 0, 0, 0);
		return last.getTime() > first.getTime()
			? {
					key: 'events.time.allDayUntil',
					values: { weekday: f.weekday.format(last), date: f.date.format(last) },
				}
			: { key: 'events.time.allDay' };
	}
	const start = new Date(occurrence.startsAt);
	const end = occurrence.endsAt ? new Date(occurrence.endsAt) : null;
	const startLabel = f.time.format(start);
	if (!end) return plain(startLabel);
	if (isSameDay(start, end)) return plain(`${startLabel}–${f.time.format(end)}`);
	return plain(
		`${startLabel} – ${f.weekday.format(end)} ${f.date.format(end)} ${f.time.format(end)}`,
	);
}

/**
 * Range of the visible month grid: the Monday on or before the 1st through the
 * Sunday on or after the last day. The leading/trailing days of the adjacent
 * months are clickable too, so their events must be loaded and expanded.
 * Includes local timed events and UTC calendar dates at either boundary.
 */
export function getMonthBounds(reference: Date): { start: Date; end: Date } {
	const year = reference.getFullYear();
	const month = reference.getMonth();
	const lead = (new Date(year, month, 1).getDay() + 6) % 7;
	const trail = (7 - new Date(year, month + 1, 0).getDay()) % 7;
	const first = new Date(year, month, 1 - lead);
	const next = new Date(year, month + 1, trail + 1);
	const start = new Date(
		Math.min(first.getTime(), Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())),
	);
	const end = new Date(
		Math.max(next.getTime(), Date.UTC(next.getFullYear(), next.getMonth(), next.getDate())) - 1,
	);
	return { start, end };
}

/** Query both UTC date values and device-local legacy instants for a calendar day. */
export function getCalendarDayBounds(reference: Date): { start: Date; end: Date } {
	const year = reference.getFullYear();
	const month = reference.getMonth();
	const day = reference.getDate();
	return {
		start: new Date(Math.min(new Date(year, month, day).getTime(), Date.UTC(year, month, day))),
		end: new Date(
			Math.max(new Date(year, month, day + 1).getTime(), Date.UTC(year, month, day + 1)) - 1,
		),
	};
}

/**
 * Exact UTC midnight is canonical, including indistinguishable legacy midnight values.
 * Other all-day timestamps are displayed in device-local time. The original timezone
 * is not stored, so it cannot be recovered or made invariant across viewers.
 */
export function eventDateForDisplay(iso: string, allDay: boolean): Date {
	const date = new Date(iso);
	const utcMidnight =
		date.getUTCHours() === 0 &&
		date.getUTCMinutes() === 0 &&
		date.getUTCSeconds() === 0 &&
		date.getUTCMilliseconds() === 0;
	return allDay && utcMidnight
		? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
		: date;
}

export function eventOverlapsCalendarDay(
	event: Pick<EventOccurrence, 'startsAt' | 'endsAt' | 'allDay'>,
	day: Date,
): boolean {
	const first = eventDateForDisplay(event.startsAt, event.allDay);
	const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
	if (event.allDay) {
		const last = eventDateForDisplay(event.endsAt ?? event.startsAt, true);
		first.setHours(0, 0, 0, 0);
		last.setHours(0, 0, 0, 0);
		return first.getTime() <= target.getTime() && target.getTime() <= last.getTime();
	}

	const end = event.endsAt
		? new Date(event.endsAt)
		: new Date(first.getTime() + DEFAULT_DURATION_MS);
	const nextDay = new Date(target);
	nextDay.setDate(nextDay.getDate() + 1);
	return first.getTime() < nextDay.getTime() && end.getTime() > target.getTime();
}
