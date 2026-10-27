export function inputDateToIso(value: string): string | null {
	if (value.trim().length === 0) return null;
	const parts = value.split('-').map((part) => Number.parseInt(part, 10));
	const year = parts[0];
	const month = parts[1];
	const day = parts[2];
	if (year === undefined || month === undefined || day === undefined) return null;
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
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
