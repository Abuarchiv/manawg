export const EVENTS_LIST_LIMIT = 1000;

export {
	eventDateForDisplay,
	eventOverlapsCalendarDay,
	expandAgendaRecurrence,
	formatEventTimeOfDay,
	formatEventTimeRange,
	getCalendarDayBounds,
	getMonthBounds,
} from './event-display';
export {
	normalizeEventDateTime,
	type SerializedWgEvent,
	serializeWgEvent,
	toDatetimeLocalValue,
	validateEventForm,
} from './event-form';
export {
	addYearsFromAnchor,
	berlinCalendarDate,
	DEFAULT_DURATION_MS,
	type EventInput,
	type EventOccurrence,
	expandRecurrence,
} from './event-recurrence';
export {
	BYDAY_TO_INDEX,
	canonicalRecurrenceRule,
	formatRecurrenceRule,
	parseRecurrenceRule,
	RECURRENCE_OPTIONS,
	type RecurrenceFreq,
} from './event-recurrence-rule';
