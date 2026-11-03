import { eventDateForDisplay } from '@/features/events/event-display';
import { toDatetimeLocalValue } from '@/features/events/event-form';
import type { EventOccurrence } from '@/features/events/event-recurrence';

/** The text and flag values of the event edit form. */
export interface EventFormValues {
	title: string;
	description: string;
	startsAt: string;
	endsAt: string;
	allDay: boolean;
	location: string;
	recurrence: string;
}

interface EventFormSource {
	title: string;
	description: string | null;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	location: string | null;
}

function toLocalInputValue(iso: string, allDay: boolean): string {
	return toDatetimeLocalValue(eventDateForDisplay(iso, allDay));
}

/** The form values that show an event, or one date of its series, with the given rule. */
export function eventFormValues(
	source: EventFormSource | EventOccurrence,
	rule: string | null,
): EventFormValues {
	return {
		title: source.title,
		description: source.description ?? '',
		startsAt: toLocalInputValue(source.startsAt, source.allDay),
		endsAt: source.endsAt ? toLocalInputValue(source.endsAt, source.allDay) : '',
		allDay: source.allDay,
		location: source.location ?? '',
		recurrence: rule ?? '',
	};
}

/**
 * Moves an open form onto a newer version of the event: a field the user left as it was takes
 * the latest value, a field the user changed keeps the typed value.
 */
export function rebaseEventForm(
	base: EventFormValues,
	latest: EventFormValues,
	current: EventFormValues,
): EventFormValues {
	const pick = <K extends keyof EventFormValues>(key: K): EventFormValues[K] =>
		current[key] === base[key] ? latest[key] : current[key];
	return {
		title: pick('title'),
		description: pick('description'),
		startsAt: pick('startsAt'),
		endsAt: pick('endsAt'),
		allDay: pick('allDay'),
		location: pick('location'),
		recurrence: pick('recurrence'),
	};
}
