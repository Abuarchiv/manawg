import { berlinDayKey, instantAtBerlinWallTime } from '@/core/utils/berlin-day';

const NOON_MINUTES = 12 * 60;

/**
 * The `occurredAt` to send for the form's date field, or null when the date is unchanged.
 * `originalDay` is the expense's current Berlin day when editing, today for a new expense.
 * `invalid` means a date was typed that cannot be turned into a point in time.
 */
export function resolveOccurredAt(
	occurredOn: string,
	originalOccurredAt: string | null,
): { iso: string | null; invalid: boolean } {
	const originalDay = berlinDayKey(originalOccurredAt ? new Date(originalOccurredAt) : new Date());
	if (!occurredOn || occurredOn === originalDay) return { iso: null, invalid: false };
	const instant = instantAtBerlinWallTime(occurredOn, NOON_MINUTES);
	return instant ? { iso: instant.toISOString(), invalid: false } : { iso: null, invalid: true };
}
