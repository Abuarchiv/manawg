import {
	berlinDayKey,
	endOfBerlinDay,
	instantAtBerlinWallTime,
	startOfBerlinDay,
} from './berlin-day';

/**
 * A picked `<input type="date">` value as an instant that is that calendar day
 * both on the device and in Berlin. Local noon does it everywhere except zones
 * far from Berlin (e.g. UTC+14), where noon falls on another Berlin day; there
 * the midpoint of the device day and the Berlin day is used, an overlap of at
 * least ten hours in every zone from UTC-11 to UTC+14.
 */
export function inputDateToIso(value: string): string | null {
	if (value.trim().length === 0) return null;
	const parts = value.split('-').map((part) => Number.parseInt(part, 10));
	const year = parts[0];
	const month = parts[1];
	const day = parts[2];
	if (year === undefined || month === undefined || day === undefined) return null;
	const noon = new Date(year, month - 1, day, 12, 0, 0);
	if (berlinDayKey(noon) === value) return noon.toISOString();
	const berlinNoon = /^\d{4}-\d{2}-\d{2}$/.test(value) ? instantAtBerlinWallTime(value, 720) : null;
	if (!berlinNoon) return noon.toISOString();
	const start = Math.max(
		new Date(year, month - 1, day).getTime(),
		startOfBerlinDay(berlinNoon).getTime(),
	);
	const end = Math.min(
		new Date(year, month - 1, day + 1).getTime(),
		endOfBerlinDay(berlinNoon).getTime() + 1,
	);
	return new Date((start + end) / 2).toISOString();
}

/** Today's date in the browser's time zone, as an `<input type="date">` value. */
export function todayInputValue(now = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** A timestamp as the `<input type="date">` value of its local calendar day. */
export function isoToInputDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? todayInputValue() : todayInputValue(date);
}

/** An untouched date input (null) is the current day, also in a tab left open past midnight. */
export function inputDateOrToday(picked: string | null, now = new Date()): string {
	return picked ?? todayInputValue(now);
}

/** Milliseconds until just after the next local midnight, so a timer fires on the new day. */
export function msUntilNextLocalDay(now = new Date()): number {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
	return next.getTime() - now.getTime();
}

/**
 * Today at local noon. Due dates are stored at noon so their UTC calendar day
 * equals the local one; `new Date()` shortly after midnight would otherwise
 * still be "yesterday" in UTC.
 */
export function todayAtLocalNoon(now = new Date()): Date {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}
