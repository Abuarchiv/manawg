import { berlinDayKey } from '@/core/utils/berlin-day';
import { addMonthsFromAnchor, MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { timedRecurrenceStart } from './event-recurrence';
import { formatRecurrenceRule, parseRecurrenceRule } from './event-recurrence-rule';

/** The calendar day a series start or exception falls on: UTC for all-day series, else Berlin. */
function seriesDayKey(instant: Date, allDay: boolean): string {
	return allDay ? instant.toISOString().slice(0, 10) : berlinDayKey(instant);
}

/**
 * The rule with every removed occurrence moved the way the series start moved. Exceptions keep
 * their calendar day relative to the start (a Berlin day for timed series, a UTC day for all-day
 * ones) and take the new start's time of day, so they also survive daylight-saving changes and a
 * switch between timed and all-day. MONTHLY and YEARLY exceptions keep their month offset from
 * the start instead of a day offset, so they stay on an occurrence of the moved series.
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
	const monthly = rule.freq === 'MONTHLY' || rule.freq === 'YEARLY';
	const nextAnchor = new Date(`${seriesDayKey(new Date(next), allDay)}T00:00:00Z`);
	const monthsFrom = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
	const previousMonths = monthsFrom(seriesDayKey(new Date(previous), previousAllDay));
	const shiftedDay = (instant: string) => {
		const key = seriesDayKey(new Date(instant), previousAllDay);
		if (monthly) {
			const months = monthsFrom(key) - previousMonths;
			return addMonthsFromAnchor(nextAnchor, nextAnchor.getUTCDate(), months)
				.toISOString()
				.slice(0, 10);
		}
		return new Date(dayOf(key) + dayShift * MS_PER_DAY).toISOString().slice(0, 10);
	};
	const exdates = rule.exdates.map((instant) => {
		const day = shiftedDay(instant);
		const moved = allDay
			? new Date(`${day}T${new Date(next).toISOString().slice(11)}`)
			: timedRecurrenceStart(new Date(next), day);
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
