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

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const date = parseValidDate(iso);
	if (!date) return 'Zeit unbekannt';
	const diff = now - date.getTime();

	// From one minute in the future on, show "in …"; smaller negative diffs
	// (client clock skew against a just-created timestamp) count as "gerade eben".
	if (diff <= -MS_PER_MINUTE) {
		const until = -diff;
		if (until < MS_PER_HOUR) {
			const m = Math.floor(until / MS_PER_MINUTE);
			return `in ${m} Min`;
		}
		if (until < MS_PER_DAY) {
			const h = Math.floor(until / MS_PER_HOUR);
			return `in ${h} Std`;
		}
		if (until < 7 * MS_PER_DAY) {
			const d = calendarDaysBetween(new Date(now), date);
			return d === 1 ? 'morgen' : `in ${d} Tagen`;
		}
		return new Intl.DateTimeFormat('de-DE', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		}).format(date);
	}

	if (diff < MS_PER_MINUTE) return 'gerade eben';
	if (diff < MS_PER_HOUR) {
		const m = Math.floor(diff / MS_PER_MINUTE);
		return `vor ${m} Min`;
	}
	if (diff < MS_PER_DAY) {
		const h = Math.floor(diff / MS_PER_HOUR);
		return `vor ${h} Std`;
	}
	if (diff < 7 * MS_PER_DAY) {
		const d = calendarDaysBetween(date, new Date(now));
		return d === 1 ? 'gestern' : `vor ${d} Tagen`;
	}
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date);
}

/**
 * `timeZone: 'Europe/Berlin'` for dates that are Berlin calendar days (chore due
 * dates, absences): a device in New York must show the same day the status
 * label ("morgen", "heute fällig") was computed for.
 */
export function formatShortDate(iso: string, timeZone?: 'Europe/Berlin'): string {
	const date = parseValidDate(iso);
	if (!date) return 'Datum unbekannt';
	return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone }).format(
		date,
	);
}

const BERLIN_DAY_MONTH_YEAR = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'Europe/Berlin',
});

/** Berlin calendar day with year ("06.10.2026"), for due dates; see `formatShortDate`. */
export function formatDayMonthYear(iso: string): string {
	const date = parseValidDate(iso);
	return date ? BERLIN_DAY_MONTH_YEAR.format(date) : 'Datum unbekannt';
}

/** Absence range: Berlin days, see `formatShortDate`. */
export function formatShortDateRange(startIso: string, endIso: string): string {
	return `${formatShortDate(startIso, 'Europe/Berlin')} bis ${formatShortDate(endIso, 'Europe/Berlin')}`;
}

export function formatTimeFull(iso: string): string {
	const date = parseValidDate(iso);
	if (!date) return 'Zeit unbekannt';
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
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

/** "Diese Woche", "Letzte Woche" or "Woche ab 08.09." for list section headers. */
export function formatWeekLabel(weekStart: Date, now = new Date()): string {
	const weeksAgo = Math.round(
		(startOfWeek(now).getTime() - weekStart.getTime()) / (7 * MS_PER_DAY),
	);
	if (weeksAgo === 0) return 'Diese Woche';
	if (weeksAgo === 1) return 'Letzte Woche';
	// Without a year, weeks exactly 52 weeks apart share a label and key.
	const year = weekStart.getFullYear() === now.getFullYear() ? '' : `${weekStart.getFullYear()}`;
	return `Woche ab ${formatShortDate(weekStart.toISOString())}${year}`;
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
