import { dateTimeFormat } from '@/shared/i18n/intl';
import type { Locale } from '@/shared/i18n/locale';
import type { Message } from '@/shared/i18n/message';

const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export function parseTimestamp(value: string | Date): number | null {
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

export function parseValidDate(value: string | Date): Date | null {
	const timestamp = parseTimestamp(value);
	return timestamp === null ? null : new Date(timestamp);
}

/**
 * Whole calendar days (device zone) from `from` to `to`. A 24h-bucket
 * is wrong near midnight: 47h ahead from 08:00 is the day after tomorrow, not "morgen".
 */
function calendarDaysBetween(from: Date, to: Date): number {
	const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	return Math.round((day(to) - day(from)) / MS_PER_DAY);
}

// Words of the string formatters; the Message helpers read the catalog.
const FALLBACK_WORDS: Record<
	Locale,
	{ unknownDate: string; unknownTime: string; rangeTo: string }
> = {
	// i18n-ignore German words of the string formatters
	de: { unknownDate: 'Datum unbekannt', unknownTime: 'Zeit unbekannt', rangeTo: 'bis' },
	en: { unknownDate: 'Date unknown', unknownTime: 'Time unknown', rangeTo: 'to' },
};

/** Day and month options: numeric in German ("06.10."), day plus short month name in English ("6 Oct"). */
export function dayMonthOptions(locale: Locale, withYear = false): Intl.DateTimeFormatOptions {
	const year = withYear ? { year: 'numeric' as const } : {};
	return locale === 'de'
		? { day: '2-digit', month: '2-digit', ...year }
		: { day: 'numeric', month: 'short', ...year };
}

function shortDateTime(locale: Locale): Intl.DateTimeFormatOptions {
	return { ...dayMonthOptions(locale), hour: '2-digit', minute: '2-digit' };
}

/** Relative time as data: buckets for the past and future; the date fallback is formatted in `locale`. */
export function relativeTimeMessage(iso: string, now = Date.now(), locale: Locale = 'de'): Message {
	const date = parseValidDate(iso);
	if (!date) return { key: 'common.time.unknown' };
	const diff = now - date.getTime();
	const absolute = (): Message => ({
		key: 'common.time.date',
		values: { date: dateTimeFormat(locale, shortDateTime(locale)).format(date) },
	});

	if (diff <= -MS_PER_MINUTE) {
		const until = -diff;
		if (until < MS_PER_HOUR) {
			return {
				key: 'common.time.minutesAhead',
				values: { count: Math.floor(until / MS_PER_MINUTE) },
			};
		}
		if (until < MS_PER_DAY) {
			return { key: 'common.time.hoursAhead', values: { count: Math.floor(until / MS_PER_HOUR) } };
		}
		if (until < 7 * MS_PER_DAY) {
			const d = calendarDaysBetween(new Date(now), date);
			return d === 1
				? { key: 'common.time.tomorrow' }
				: { key: 'common.time.daysAhead', values: { count: d } };
		}
		return absolute();
	}

	if (diff < MS_PER_MINUTE) return { key: 'common.time.justNow' };
	if (diff < MS_PER_HOUR) {
		return { key: 'common.time.minutesAgo', values: { count: Math.floor(diff / MS_PER_MINUTE) } };
	}
	if (diff < MS_PER_DAY) {
		return { key: 'common.time.hoursAgo', values: { count: Math.floor(diff / MS_PER_HOUR) } };
	}
	if (diff < 7 * MS_PER_DAY) {
		const d = calendarDaysBetween(date, new Date(now));
		return d === 1
			? { key: 'common.time.yesterday' }
			: { key: 'common.time.daysAgo', values: { count: d } };
	}
	return absolute();
}

/**
 * `timeZone: 'Europe/Berlin'` for dates that are Berlin calendar days (chore due
 * dates, absences): a device in New York must show the same day the status
 * label ("morgen", "heute fällig") was computed for.
 */
export function formatShortDate(
	iso: string,
	timeZone?: 'Europe/Berlin',
	locale: Locale = 'de',
): string {
	const date = parseValidDate(iso);
	if (!date) return FALLBACK_WORDS[locale].unknownDate;
	return dateTimeFormat(locale, { ...dayMonthOptions(locale), timeZone }).format(date);
}

/** Berlin calendar day with year ("06.10.2026"), for due dates; see `formatShortDate`. */
export function formatDayMonthYear(iso: string, locale: Locale = 'de'): string {
	const date = parseValidDate(iso);
	if (!date) return FALLBACK_WORDS[locale].unknownDate;
	return dateTimeFormat(locale, {
		...dayMonthOptions(locale, true),
		timeZone: 'Europe/Berlin',
	}).format(date);
}

/** Absence range: Berlin days, see `formatShortDate`; a single day prints once. */
export function formatShortDateRange(
	startIso: string,
	endIso: string,
	locale: Locale = 'de',
): string {
	const from = formatShortDate(startIso, 'Europe/Berlin', locale);
	if (formatDayMonthYear(startIso, locale) === formatDayMonthYear(endIso, locale)) return from;
	return `${from} ${FALLBACK_WORDS[locale].rangeTo} ${formatShortDate(endIso, 'Europe/Berlin', locale)}`;
}

export function formatTimeFull(iso: string, locale: Locale = 'de'): string {
	const date = parseValidDate(iso);
	if (!date) return FALLBACK_WORDS[locale].unknownTime;
	return dateTimeFormat(locale, {
		...dayMonthOptions(locale, true),
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}

/** Monday 00:00 (local time) of the week containing `date`. */
export function startOfWeek(date: Date): Date {
	const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
	return start;
}

/** Week header for list sections (this week, last week, week of a date); the date is formatted in `locale`. */
export function weekLabelMessage(
	weekStart: Date,
	now = new Date(),
	locale: Locale = 'de',
): Message {
	const weeksAgo = Math.round(
		(startOfWeek(now).getTime() - weekStart.getTime()) / (7 * MS_PER_DAY),
	);
	if (weeksAgo === 0) return { key: 'common.time.thisWeek' };
	if (weeksAgo === 1) return { key: 'common.time.lastWeek' };
	// Without a year, weeks exactly 52 weeks apart share a label and key.
	const sameYear = weekStart.getFullYear() === now.getFullYear();
	const date = dateTimeFormat(locale, {
		...dayMonthOptions(locale, !sameYear),
	}).format(weekStart);
	return { key: 'common.time.weekOf', values: { date } };
}

export function addMonths(date: Date, months: number): Date {
	const next = new Date(date);
	const day = next.getUTCDate();
	next.setUTCMonth(next.getUTCMonth() + months, 1);
	const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
	next.setUTCDate(Math.min(day, lastDay));
	return next;
}

/**
 * Advance `from` by `months` while keeping the ANCHOR's day-of-month, so a
 * month-end due date never drifts (anchor day 31: 31.01 → 28.02 → 31.03 →
 * 30.04 …). Chaining plain addMonths would clamp once and stay clamped.
 */
export function addMonthsFromAnchor(from: Date, anchorDay: number, months: number): Date {
	const next = new Date(from);
	next.setUTCMonth(next.getUTCMonth() + months, 1);
	const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
	next.setUTCDate(Math.min(anchorDay, lastDay));
	return next;
}
