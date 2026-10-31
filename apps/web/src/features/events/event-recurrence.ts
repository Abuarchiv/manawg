import {
	berlinDayKey,
	berlinWallMinutes,
	instantAtBerlinWallTimeOrAfterGap,
} from '@/core/utils/berlin-day';
import { addMonths, addMonthsFromAnchor, MS_PER_DAY, parseTimestamp } from '@/core/utils/time';
import {
	BYDAY_TO_INDEX,
	isExcludedOccurrence,
	parseRecurrenceRule,
	type RecurrenceFreq,
	type RecurrenceRule,
} from './event-recurrence-rule';

export interface EventInput {
	id: string;
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurrence: string | null;
	createdAt?: string;
	updatedAt?: string;
}

export interface EventOccurrence {
	eventId: string;
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
	recurring: boolean;
	occurrenceIndex: number;
	createdAt?: string;
	updatedAt?: string;
}

const MAX_EXPAND_ITERATIONS = 366;
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** UTC-midnight date whose UTC fields represent the instant's Berlin calendar date. */
export function berlinCalendarDate(date: Date): Date {
	return new Date(`${berlinDayKey(date)}T00:00:00.000Z`);
}

/** Preserve exact starts for exclusions, including the anchor's choice of the repeated DST hour. */
export function timedRecurrenceStart(anchor: Date, dayKey: string): Date | null {
	if (berlinDayKey(anchor) === dayKey) return new Date(anchor);
	const instant = instantAtBerlinWallTimeOrAfterGap(dayKey, berlinWallMinutes(anchor));
	return instant
		? new Date(instant.getTime() + anchor.getUTCSeconds() * 1_000 + anchor.getUTCMilliseconds())
		: null;
}

function addToDate(date: Date, freq: RecurrenceFreq, interval: number): Date {
	const next = new Date(date);
	if (freq === 'DAILY') {
		next.setUTCDate(next.getUTCDate() + interval);
	} else if (freq === 'WEEKLY') {
		next.setUTCDate(next.getUTCDate() + 7 * interval);
	} else if (freq === 'MONTHLY') {
		return addMonths(next, interval);
	} else {
		next.setUTCFullYear(next.getUTCFullYear() + interval);
	}
	return next;
}

interface ExpansionWindow {
	from: number;
	to: number;
}

function withinWindow(
	occurrenceStart: number,
	occurrenceEnd: number,
	window: ExpansionWindow,
	allDay: boolean,
): boolean {
	return (
		(allDay ? occurrenceEnd >= window.from : occurrenceEnd > window.from) &&
		occurrenceStart <= window.to
	);
}

function buildOccurrence(
	event: EventInput,
	startMs: number,
	durationMs: number,
	occurrenceIndex: number,
	isRecurring: boolean,
): EventOccurrence {
	const start = new Date(startMs);
	const end = new Date(startMs + durationMs);
	return {
		eventId: event.id,
		title: event.title,
		description: event.description,
		startsAt: start.toISOString(),
		endsAt: event.endsAt ? end.toISOString() : null,
		allDay: event.allDay,
		location: event.location,
		recurring: isRecurring,
		occurrenceIndex,
		...(event.createdAt !== undefined ? { createdAt: event.createdAt } : {}),
		...(event.updatedAt !== undefined ? { updatedAt: event.updatedAt } : {}),
	};
}

export function durationMsFor(event: EventInput, startMs: number): number {
	if (!event.endsAt) return DEFAULT_DURATION_MS;
	const endMs = parseTimestamp(event.endsAt);
	if (event.allDay && endMs === startMs) return 0;
	if (endMs === null || endMs <= startMs) return DEFAULT_DURATION_MS;
	return endMs - startMs;
}

interface ForwardSkip {
	/** ms timestamp of the first occurrence to resume iterating from. */
	startMs: number;
	/** occurrenceIndex of that occurrence (0-based, counting from the original startsAt). */
	index: number;
}

/**
 * Fast-forwards analytically to the last occurrence at or before window.from, preserving
 * the exact recurrence phase (day-of-week / day-of-month / time-of-day). Walking forward
 * from the event's original startsAt one period at a time, bounded by
 * MAX_EXPAND_ITERATIONS, could spend the whole iteration budget on an old event with no
 * end date before reaching the query window and silently return zero occurrences. After
 * the jump, the bounded loop always has budget left to cover the window itself,
 * regardless of the event's age.
 *
 * MONTHLY/YEARLY are included too: with INTERVAL=1 (the common case),
 * MAX_EXPAND_ITERATIONS=366 is only ~30.5 years for MONTHLY and 366 years
 * for YEARLY, both reachable in practice.
 */
function computeForwardSkip(
	rule: RecurrenceRule,
	startMs: number,
	anchorWeekStartMs: number,
	windowFromMs: number,
	weeklyByDay: boolean,
	weeklyAllowedDays: Set<number> | null,
): ForwardSkip {
	const noSkip: ForwardSkip = { startMs, index: 0 };
	if (windowFromMs <= startMs) return noSkip;

	if (rule.freq === 'DAILY') {
		const periodMs = rule.interval * MS_PER_DAY;
		const steps = Math.floor((windowFromMs - startMs) / periodMs);
		if (steps <= 0) return noSkip;
		return { startMs: startMs + steps * periodMs, index: steps };
	}

	if (rule.freq === 'WEEKLY' && !weeklyByDay) {
		const periodMs = rule.interval * 7 * MS_PER_DAY;
		const steps = Math.floor((windowFromMs - startMs) / periodMs);
		if (steps <= 0) return noSkip;
		return { startMs: startMs + steps * periodMs, index: steps };
	}

	if (rule.freq === 'WEEKLY' && weeklyByDay && weeklyAllowedDays) {
		if (windowFromMs <= anchorWeekStartMs) return noSkip;
		const targetWeekOffset = Math.floor((windowFromMs - anchorWeekStartMs) / (7 * MS_PER_DAY));
		const weekBlocks = Math.floor(targetWeekOffset / rule.interval);
		if (weekBlocks <= 0) return noSkip;
		const skippedMs = anchorWeekStartMs + weekBlocks * rule.interval * 7 * MS_PER_DAY;
		if (skippedMs <= startMs) return noSkip;
		// The anchor week can be partial: iteration starts at the event's
		// weekday, not at Sunday. Count that prefix separately so fast-forwarding
		// preserves COUNT and stable occurrence UIDs.
		const anchorWeekday = new Date(startMs).getUTCDay();
		const anchorWeekCount = [...weeklyAllowedDays].filter((day) => day >= anchorWeekday).length;
		return {
			startMs: skippedMs,
			index: anchorWeekCount + Math.max(0, weekBlocks - 1) * weeklyAllowedDays.size,
		};
	}

	if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
		return computeAnchoredSkip(new Date(startMs), rule.freq, rule.interval, windowFromMs);
	}

	return noSkip;
}

/**
 * Analytic fast-forward for MONTHLY/YEARLY, mirroring the DAILY/WEEKLY skip
 * above but using calendar-unit arithmetic (months/years vary in length, so
 * this can't be a fixed-ms period). Uses the same addFromAnchor() the main
 * loop uses, so the day-of-month clamping behavior (e.g. Jan 31 -> Feb 28)
 * stays identical to the unskipped walk. Overshoot (possible near month
 * boundaries because month length is uneven) is corrected by stepping back
 * one interval at a time until the candidate is at or before the window.
 */
function computeAnchoredSkip(
	anchor: Date,
	freq: 'MONTHLY' | 'YEARLY',
	interval: number,
	windowFromMs: number,
): ForwardSkip {
	const startMs = anchor.getTime();
	const noSkip: ForwardSkip = { startMs, index: 0 };

	const unitsDiff =
		freq === 'MONTHLY'
			? (new Date(windowFromMs).getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
				(new Date(windowFromMs).getUTCMonth() - anchor.getUTCMonth())
			: new Date(windowFromMs).getUTCFullYear() - anchor.getUTCFullYear();

	let steps = Math.floor(unitsDiff / interval);
	if (steps <= 0) return noSkip;

	let candidateMs = addFromAnchor(anchor, freq, interval * steps).getTime();
	while (candidateMs > windowFromMs && steps > 0) {
		steps -= 1;
		candidateMs = steps > 0 ? addFromAnchor(anchor, freq, interval * steps).getTime() : startMs;
	}
	if (steps <= 0) return noSkip;

	return { startMs: candidateMs, index: steps };
}

export function expandRecurrence(
	event: EventInput,
	from: Date | string,
	to: Date | string,
	/** Bounds iterations and returned occurrences; wide windows (the calendar feed) raise it. */
	maxExpand = MAX_EXPAND_ITERATIONS,
): EventOccurrence[] {
	const startMs = parseTimestamp(event.startsAt);
	const fromMs = parseTimestamp(from instanceof Date ? from.toISOString() : from);
	const toMs = parseTimestamp(to instanceof Date ? to.toISOString() : to);
	if (startMs === null || fromMs === null || toMs === null || fromMs > toMs) return [];

	const window: ExpansionWindow = { from: fromMs, to: toMs };
	const baseDuration = durationMsFor(event, startMs);
	const rule = parseRecurrenceRule(event.recurrence);

	if (!rule) {
		if (!withinWindow(startMs, startMs + baseDuration, window, event.allDay)) return [];
		return [buildOccurrence(event, startMs, baseDuration, 0, false)];
	}

	const untilMs =
		rule.until !== undefined ? (parseTimestamp(rule.until) ?? Number.POSITIVE_INFINITY) : null;
	const occurrences: EventOccurrence[] = [];
	const anchor = new Date(startMs);
	const recurrenceAnchor = event.allDay ? anchor : berlinCalendarDate(anchor);
	const recurrenceStartMs = recurrenceAnchor.getTime();
	const weeklyByDay = rule.freq === 'WEEKLY' && !!rule.byDay && rule.byDay.length > 0;
	const weeklyAllowedDays = weeklyByDay ? new Set(rule.byDay?.map((d) => BYDAY_TO_INDEX[d])) : null;
	const anchorWeekStartMs = recurrenceStartMs - recurrenceAnchor.getUTCDay() * MS_PER_DAY;
	const skipFromMs = window.from - baseDuration;
	const recurrenceSkipFromMs = event.allDay
		? skipFromMs
		: berlinCalendarDate(new Date(skipFromMs)).getTime();
	const skip = computeForwardSkip(
		rule,
		recurrenceStartMs,
		anchorWeekStartMs,
		recurrenceSkipFromMs,
		weeklyByDay,
		weeklyAllowedDays,
	);
	let current = new Date(skip.startMs);
	let index = skip.index;
	// For MONTHLY/YEARLY, skip.index counts the same calendar-unit steps that
	// stepIndex tracks below, so resume from there. Other freqs don't use
	// stepIndex, so 0 is harmless for them.
	let stepIndex = rule.freq === 'MONTHLY' || rule.freq === 'YEARLY' ? skip.index : 0;
	let iterations = 0;

	while (iterations < maxExpand) {
		iterations += 1;
		const occurrenceDayMs = current.getTime();
		// Resolve the anchor's Berlin wall time on each recurrence date. If that
		// time falls in the spring gap, it moves to the hour after the gap.
		const occurrenceMs = event.allDay
			? occurrenceDayMs
			: (timedRecurrenceStart(anchor, berlinDayKey(current))?.getTime() ??
				startMs + occurrenceDayMs - recurrenceStartMs);
		if (occurrenceMs > window.to) break;
		if (untilMs !== null && occurrenceMs > untilMs) break;
		if (rule.count !== undefined && index >= rule.count) break;

		let emit = true;
		if (weeklyAllowedDays) {
			const weekOffset = Math.floor((occurrenceDayMs - anchorWeekStartMs) / (7 * MS_PER_DAY));
			emit = weeklyAllowedDays.has(current.getUTCDay()) && weekOffset % rule.interval === 0;
		}

		if (emit) {
			// Minute-rounded exclusions remain valid for existing series, including the repeated hour.
			const legacyStart =
				!event.allDay && rule.exdates?.length
					? instantAtBerlinWallTimeOrAfterGap(berlinDayKey(current), berlinWallMinutes(anchor))
					: null;
			const excluded =
				isExcludedOccurrence(rule, occurrenceMs) ||
				(legacyStart !== null && isExcludedOccurrence(rule, legacyStart.getTime()));
			if (
				!excluded &&
				withinWindow(occurrenceMs, occurrenceMs + baseDuration, window, event.allDay)
			) {
				occurrences.push(buildOccurrence(event, occurrenceMs, baseDuration, index, true));
			}
			index += 1;
			if (occurrences.length >= maxExpand) break;
		}

		if (weeklyByDay) {
			current = new Date(current.getTime() + MS_PER_DAY);
			// Weeks between interval blocks hold no occurrences; jump to the next block's
			// Sunday so a long INTERVAL does not burn the iteration budget day by day.
			const weeksIntoBlock =
				Math.floor((current.getTime() - anchorWeekStartMs) / (7 * MS_PER_DAY)) % rule.interval;
			if (weeksIntoBlock !== 0) {
				const weekStartMs = current.getTime() - current.getUTCDay() * MS_PER_DAY;
				current = new Date(weekStartMs + (rule.interval - weeksIntoBlock) * 7 * MS_PER_DAY);
			}
		} else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
			stepIndex += 1;
			current = addFromAnchor(recurrenceAnchor, rule.freq, rule.interval * stepIndex);
		} else {
			current = addToDate(current, rule.freq, rule.interval);
		}
	}

	return occurrences;
}

/**
 * The anchor moved by whole years. A 29 February anchor falls on 28 February in
 * other years, as people expect for birthdays; plain `setUTCFullYear` rolled it
 * over to 1 March.
 */
export function addYearsFromAnchor(anchor: Date, years: number): Date {
	return addMonthsFromAnchor(anchor, anchor.getUTCDate(), years * MONTHS_PER_YEAR);
}

const MONTHS_PER_YEAR = 12;

function addFromAnchor(anchor: Date, freq: RecurrenceFreq, totalInterval: number): Date {
	if (freq === 'MONTHLY') return addMonthsFromAnchor(anchor, anchor.getUTCDate(), totalInterval);
	return addYearsFromAnchor(anchor, totalInterval);
}
