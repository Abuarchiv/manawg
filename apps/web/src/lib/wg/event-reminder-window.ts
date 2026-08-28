import { nextBerlinDayStart, startOfBerlinDay } from '@/core/utils/berlin-day';

const DEFAULT_HORIZON_YEARS = 2;

export function computeHorizonStart(now: Date, years = DEFAULT_HORIZON_YEARS): Date {
	return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Shared recurrence lookback horizon. A recurring event with no end date
 * needs its original `startsAt` row to still be fetched by SQL filters even
 * when it is older than the query window — `expandRecurrence()` walks
 * forward from the query window rather than from `startsAt`. The calendar
 * events API and the event-reminders cron MUST use the same horizon here, or
 * a recurring event older than one horizon but within the other becomes
 * reachable by one call site and invisible to the other.
 */
export function computeRecurrenceLookbackStart(reference: Date): Date {
	return computeHorizonStart(reference, DEFAULT_HORIZON_YEARS);
}

/**
 * "Tomorrow" in Europe/Berlin — the timezone users schedule events in. A UTC
 * day boundary misclassifies events between 00:00 and 02:00 Berlin time
 * (CET is UTC+1, CEST UTC+2), reminding a day early or late.
 */
export function computeTomorrowUtcWindow(now: Date): { start: Date; end: Date } {
	const todayStart = startOfBerlinDay(now);
	const start = nextBerlinDayStart(todayStart);
	const end = new Date(nextBerlinDayStart(start).getTime() - 1);
	return { start, end };
}
