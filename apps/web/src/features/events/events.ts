export const EVENTS_LIST_LIMIT = 1000;

export {
	type RecurrenceFreq,
	RECURRENCE_OPTIONS,
	BYDAY_TO_INDEX,
	parseRecurrenceRule,
	formatRecurrenceRule,
	canonicalRecurrenceRule,
} from './event-recurrence-rule';
export {
	type EventInput,
	type EventOccurrence,
	DEFAULT_DURATION_MS,
	berlinCalendarDate,
	expandRecurrence,
	addYearsFromAnchor,
} from './event-recurrence';
export {
	expandAgendaRecurrence,
	formatEventTimeRange,
	formatEventTimeOfDay,
	getMonthBounds,
	getCalendarDayBounds,
	eventDateForDisplay,
	eventOverlapsCalendarDay,
} from './event-display';
export {
	type SerializedWgEvent,
	serializeWgEvent,
	normalizeEventDateTime,
	toDatetimeLocalValue,
	validateEventForm,
} from './event-form';
