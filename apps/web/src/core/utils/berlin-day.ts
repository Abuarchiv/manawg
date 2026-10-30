/**
 * Day-boundary helpers for Europe/Berlin, the app's fixed wall-clock zone.
 *
 * Server processes run in UTC, so `setHours(0, 0, 0, 0)` would give UTC
 * midnight. These helpers resolve "today" by the Berlin wall clock across both
 * DST transitions (23h spring-forward and 25h fall-back days).
 */

import { MS_PER_HOUR } from './time';

const BERLIN_TZ = 'Europe/Berlin';
// Berlin is UTC+1 (CET) in winter and UTC+2 (CEST) in summer.
const BERLIN_UTC_OFFSET_HOURS = [1, 2];
// From any Berlin midnight, +30h lands mid-morning of the following Berlin
// day regardless of whether the current day is 23, 24, or 25 hours long.
const NEXT_DAY_PROBE_MS = 30 * MS_PER_HOUR;

// en-CA formats as YYYY-MM-DD, which doubles as a sortable bucket key.
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: BERLIN_TZ,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

const hourFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: BERLIN_TZ,
	hour: 'numeric',
	hourCycle: 'h23',
});

/** Calendar date (YYYY-MM-DD) of the given instant in Berlin. */
export function berlinDayKey(date: Date): string {
	return dayKeyFormat.format(date);
}

/**
 * Berlin calendar day of a stored value: a YYYY-MM-DD key passes through, an ISO
 * instant is converted, anything unreadable gives '' (an empty form field).
 */
export function toBerlinDayKey(value: string): string {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const instant = new Date(value);
	return Number.isNaN(instant.getTime()) ? '' : berlinDayKey(instant);
}

/**
 * Whole Berlin calendar days from `from` to `to` (negative when `to` is
 * earlier). Counts date changes, not 24h spans: a chore due this evening is
 * 0 days away, not "morgen", and DST days still count as one day.
 */
export function berlinCalendarDayDistance(from: Date, to: Date): number {
	const dayMs = (date: Date) => Date.parse(`${berlinDayKey(date)}T12:00:00Z`);
	return Math.round((dayMs(to) - dayMs(from)) / (24 * MS_PER_HOUR));
}

function berlinHour(date: Date): number {
	return Number(hourFormat.format(date));
}

/** Instant at which the Berlin day containing `date` began (Berlin midnight). */
export function startOfBerlinDay(date: Date): Date {
	const key = berlinDayKey(date);
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
	if (!match) throw new Error(`Unexpected Berlin day key: ${key}`);
	const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	for (const offsetHours of BERLIN_UTC_OFFSET_HOURS) {
		const candidate = new Date(utcMidnight - offsetHours * MS_PER_HOUR);
		if (berlinDayKey(candidate) === key && berlinHour(candidate) === 0) {
			return candidate;
		}
	}
	// Unreachable while Berlin observes CET/CEST; guards against tz-data drift.
	throw new Error(`Cannot resolve Berlin midnight for ${key}`);
}

/** Last millisecond of the Berlin day containing `date`. */
export function endOfBerlinDay(date: Date): Date {
	return new Date(nextBerlinDayStart(startOfBerlinDay(date)).getTime() - 1);
}

const wallTimeFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: BERLIN_TZ,
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

/** Minutes since Berlin midnight of the given instant's Berlin day. */
export function berlinWallMinutes(date: Date): number {
	const [h, m] = wallTimeFormat.format(date).split(':');
	return Number(h) * 60 + Number(m);
}

/**
 * The UTC instant at which the Berlin wall clock reads `minutes` on `dayKey`.
 * Returns null only for wall times inside the spring-forward gap (02:00–03:00
 * that do not exist that day).
 */
export function instantAtBerlinWallTime(dayKey: string, minutes: number): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
	if (!match) throw new Error(`Unexpected Berlin day key: ${dayKey}`);
	const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	for (const offsetHours of BERLIN_UTC_OFFSET_HOURS) {
		const candidate = new Date(utcMidnight + minutes * 60_000 - offsetHours * MS_PER_HOUR);
		if (berlinDayKey(candidate) === dayKey && berlinWallMinutes(candidate) === minutes) {
			return candidate;
		}
	}
	return null;
}

/** Berlin midnight following the given Berlin-day start (DST-safe stepping). */
export function nextBerlinDayStart(dayStart: Date): Date {
	return startOfBerlinDay(new Date(dayStart.getTime() + NEXT_DAY_PROBE_MS));
}

/** Berlin midnight preceding the given Berlin-day start (DST-safe stepping). */
export function prevBerlinDayStart(dayStart: Date): Date {
	return startOfBerlinDay(new Date(dayStart.getTime() - 1));
}
