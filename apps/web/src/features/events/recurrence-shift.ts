import {
	berlinCalendarDayDistance,
	berlinDayKey,
	berlinWallMinutes,
	instantAtBerlinWallTime,
} from '@/core/utils/berlin-day';
import { MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import { formatRecurrenceRule, parseRecurrenceRule } from './recurrence-rule';

/**
 * The rule with every removed occurrence moved the way the series start moved. Timed series
 * keep their Berlin wall time across daylight-saving changes, so each exception moves by the
 * same calendar days and the same change of wall time; all-day series move by plain time.
 */
export function withShiftedExclusions(
	recurrence: string,
	previousStartsAt: string,
	nextStartsAt: string,
	allDay: boolean,
): string {
	const rule = parseRecurrenceRule(recurrence);
	const previous = parseTimestamp(previousStartsAt);
	const next = parseTimestamp(nextStartsAt);
	if (!rule?.exdates || rule.exdates.length === 0 || previous === null || next === null) {
		return recurrence;
	}
	if (previous === next) return recurrence;
	const dayShift = berlinCalendarDayDistance(new Date(previous), new Date(next));
	const wallShift = berlinWallMinutes(new Date(next)) - berlinWallMinutes(new Date(previous));
	const exdates = rule.exdates.map((instant) => {
		const moved = Date.parse(instant) + (next - previous);
		if (allDay) return new Date(moved).toISOString();
		const original = new Date(instant);
		const day = new Date(Date.parse(`${berlinDayKey(original)}T12:00:00Z`) + dayShift * MS_PER_DAY);
		const minutes = berlinWallMinutes(original) + wallShift;
		const shifted =
			minutes >= 0 && minutes < 24 * 60
				? instantAtBerlinWallTime(day.toISOString().slice(0, 10), minutes)
				: null;
		return (shifted ?? new Date(moved)).toISOString();
	});
	return formatRecurrenceRule({ ...rule, exdates: exdates.sort() });
}

/** The series rule of a save: empty means none, otherwise removed occurrences follow the start. */
export function shiftedSeriesRule(
	rule: string,
	previousStartsAt: string,
	nextStart: Date,
	allDay: boolean,
): string | null {
	if (!rule) return null;
	return withShiftedExclusions(rule, previousStartsAt, nextStart.toISOString(), allDay);
}
