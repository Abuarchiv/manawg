/**
 * Pure helpers for recurring-chore due-date math.
 *
 * The next due date anchors on the previous due date so the cadence stays
 * stable (a monthly chore completed 5 days early must not slide 5 days earlier,
 * which would drift ~60 days off-cadence over a year). Once the due day has
 * passed, it re-anchors on `completedAt` so a massively overdue chore is not
 * scheduled in the past:
 *
 *   nextDueAt = (late ? completedAt : prevDueAt) + interval
 *
 * `recurrenceType: 'days' | 'months'` exists because "monatlich" as
 * `intervalDays = 30` would drift (12×30 = 360 days). The 'months' branch adds
 * calendar months so 12 monthly cycles land on the same calendar day each
 * year. Month-end is clamped (Jan 31 + 1 month → Feb 28/29, NOT March 3).
 *
 * Both branches step on the Europe/Berlin calendar, so the wall-clock time
 * (and near midnight the weekday) does not shift across DST.
 */

import type { ChoreRecurrenceType } from '@/core/db/schema';
import {
	berlinDayKey,
	berlinWallMinutes,
	instantAtBerlinWallTimeOrAfterGap,
} from '@/core/utils/berlin-day';

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
/** Berlin's spring-forward gap: wall times 02:00–02:59 do not exist that night. */
const DST_GAP_START_MINUTES = 2 * MINUTES_PER_HOUR;
const DST_GAP_END_MINUTES = 3 * MINUTES_PER_HOUR;

interface BerlinWallTime {
	year: number;
	/** 0-based month, like `Date.getUTCMonth()`. */
	month: number;
	day: number;
	minutes: number;
	subMinuteMs: number;
}

function toBerlinWallTime(date: Date): BerlinWallTime {
	const [year, month, day] = berlinDayKey(date).split('-').map(Number) as [number, number, number];
	return {
		year,
		month: month - 1,
		day,
		minutes: berlinWallMinutes(date),
		subMinuteMs: ((date.getTime() % MS_PER_MINUTE) + MS_PER_MINUTE) % MS_PER_MINUTE,
	};
}

function fromBerlinWallTime(wall: BerlinWallTime): Date {
	// Normalize overflowing day/month values (e.g. day 35) via UTC calendar math.
	const normalized = new Date(Date.UTC(wall.year, wall.month, wall.day));
	const dayKey = normalized.toISOString().slice(0, 10);
	const instant = instantAtBerlinWallTimeOrAfterGap(dayKey, wall.minutes);
	if (!instant) throw new Error(`Cannot resolve Berlin wall time on ${dayKey}`);
	return new Date(instant.getTime() + wall.subMinuteMs);
}

/**
 * Undo the one-hour push `fromBerlinWallTime` applies inside the
 * spring-forward gap. Without this, a chore due at 02:30 lands on 03:30 that
 * night and then keeps 03:30 forever, because every later cycle copies the
 * previous due time. Only a due time exactly one hour after a gap-hour anchor
 * is corrected, so a time the user moved deliberately stays as it is.
 */
function restoreGapShiftedTime(wall: BerlinWallTime, anchorAt?: Date): BerlinWallTime {
	if (!anchorAt) return wall;
	const anchorMinutes = berlinWallMinutes(anchorAt);
	const anchorInGapHour =
		anchorMinutes >= DST_GAP_START_MINUTES && anchorMinutes < DST_GAP_END_MINUTES;
	if (!anchorInGapHour || wall.minutes !== anchorMinutes + MINUTES_PER_HOUR) return wall;
	return { ...wall, minutes: anchorMinutes };
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * A completion is late only once the Berlin due *day* has passed. Finishing a
 * chore on its due day after the due time is the normal case and must not
 * re-anchor the cadence.
 */
export function isLateCompletion(prevDueAt: Date, completedAt: Date): boolean {
	return berlinDayKey(completedAt) > berlinDayKey(prevDueAt);
}

/**
 * Compute the next due date for a recurring chore after completion.
 *
 * All calendar math runs on the Europe/Berlin wall clock, so a daily cadence
 * keeps its local time across DST switches and month-end clamping follows the
 * Berlin calendar day members see.
 *
 * @param prevDueAt      the chore's current `nextDueAt` before completion
 * @param interval       cadence in days OR months (see `recurrenceType`);
 *                       `0` keeps the previous due (one-shot)
 * @param completedAt    timestamp at which the chore was completed
 * @param recurrenceType `'days'` (Berlin calendar days, legacy default) or
 *                       `'months'` (Berlin calendar months)
 * @param anchorAt       original cadence anchor; keeps the month-end
 *                       day-of-month stable across clamps (31.01 → 28.02 →
 *                       31.03). Omitted for a chore
 *                       that is not stored yet — prevDueAt is the anchor then.
 */
export function computeNextDueAt(
	prevDueAt: Date,
	interval: number,
	completedAt: Date,
	recurrenceType: ChoreRecurrenceType = 'days',
	anchorAt?: Date,
): Date {
	if (!Number.isFinite(interval) || interval <= 0) {
		// One-shot / non-recurring chore: do not advance the cadence. The
		// route still rotates the assignee, so we return the existing due
		// date unchanged (acts as a no-op for the cadence stamp).
		return new Date(prevDueAt.getTime());
	}
	// A LATE completion (a later Berlin day) re-anchors the cycle on
	// completedAt (documented behavior). Early and same-day completions keep
	// the previous due so the cadence does not slide.
	const late = isLateCompletion(prevDueAt, completedAt);
	const base = late
		? toBerlinWallTime(completedAt)
		: restoreGapShiftedTime(toBerlinWallTime(prevDueAt), anchorAt);
	if (recurrenceType === 'months') {
		// Keep the stored anchor so a month-end clamp (31.01 → 28.02) does not
		// chain into a permanent day-of-month drift.
		const anchorDay = toBerlinWallTime(late ? completedAt : (anchorAt ?? prevDueAt)).day;
		const target = new Date(Date.UTC(base.year, base.month + interval, 1));
		const year = target.getUTCFullYear();
		const month = target.getUTCMonth();
		return fromBerlinWallTime({
			...base,
			year,
			month,
			day: Math.min(anchorDay, daysInMonth(year, month)),
		});
	}
	return fromBerlinWallTime({ ...base, day: base.day + interval });
}
