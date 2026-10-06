/** Field limits shared by the event form and the event API routes. */
export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 2_000;
export const EVENT_LOCATION_MAX = 200;
export const EVENT_RECURRENCE_MAX = 200;

// Wide enough for yearly birthdays and long-range planning; anything outside is
// a typo (year 0026, 20266) that would otherwise be stored and expanded.
export const EVENT_YEAR_MIN = 1900;
export const EVENT_YEAR_MAX = 2200;

export function isEventYearInRange(date: Date): boolean {
	const year = date.getUTCFullYear();
	return !Number.isNaN(year) && year >= EVENT_YEAR_MIN && year <= EVENT_YEAR_MAX;
}
