import { berlinDayKey, berlinWallMinutes, instantAtBerlinWallTime } from '@/core/utils/berlin-day';
import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { formatRecurrenceRule, parseRecurrenceRule } from './recurrence-rule';

/** The calendar day a series start or exception falls on: UTC for all-day series, else Berlin. */
function seriesDayKey(instant: Date, allDay: boolean): string {
	return allDay ? instant.toISOString().slice(0, 10) : berlinDayKey(instant);
}

/**
 * The rule with every removed occurrence moved the way the series start moved. Exceptions keep
 * their calendar day relative to the start (a Berlin day for timed series, a UTC day for all-day
 * ones) and take the new start's time of day, so they also survive daylight-saving changes and a
 * switch between timed and all-day.
 */
export function withShiftedExclusions(
	recurrence: string,
	previousStartsAt: string,
	nextStartsAt: string,
	allDay: boolean,
	previousAllDay: boolean = allDay,
): string {
	const rule = parseRecurrenceRule(recurrence);
	const previous = parseTimestamp(previousStartsAt);
	const next = parseTimestamp(nextStartsAt);
	if (!rule?.exdates || rule.exdates.length === 0 || previous === null || next === null) {
		return recurrence;
	}
	if (previous === next && allDay === previousAllDay) return recurrence;
	const dayOf = (key: string) => Date.parse(`${key}T12:00:00Z`);
	const dayShift = Math.round(
		(dayOf(seriesDayKey(new Date(next), allDay)) -
			dayOf(seriesDayKey(new Date(previous), previousAllDay))) /
			MS_PER_DAY,
	);
	const nextWallMinutes = berlinWallMinutes(new Date(next));
	const exdates = rule.exdates.map((instant) => {
		const day = new Date(
			dayOf(seriesDayKey(new Date(instant), previousAllDay)) + dayShift * MS_PER_DAY,
		)
			.toISOString()
			.slice(0, 10);
		const moved = allDay
			? new Date(`${day}T${new Date(next).toISOString().slice(11)}`)
			: instantAtBerlinWallTime(day, nextWallMinutes);
		return (moved ?? new Date(Date.parse(instant) + (next - previous))).toISOString();
	});
	return formatRecurrenceRule({ ...rule, exdates: exdates.sort() });
}

/** The series rule of a save: empty means none, otherwise removed occurrences follow the start. */
export function shiftedSeriesRule(
	rule: string,
	previousStartsAt: string,
	nextStart: Date,
	allDay: boolean,
	previousAllDay: boolean,
): string | null {
	if (!rule) return null;
	return withShiftedExclusions(
		rule,
		previousStartsAt,
		nextStart.toISOString(),
		allDay,
		previousAllDay,
	);
}
