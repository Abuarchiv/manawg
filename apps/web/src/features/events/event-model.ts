/** A stored event as the expansion and display helpers read it (dates as ISO strings). */
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

/** Duration of a timed event without a (valid) end. */
export const DEFAULT_DURATION_MS = 60 * 60 * 1000;
