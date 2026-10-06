import type { wgEvents } from '@/core/db/schema';
import { isEventYearInRange } from '@/features/events/event-limits';
import { eventDateForDisplay, isSameDay } from './event-display';
import type { EventInput } from './event-model';

export * from './event-display';
export * from './event-model';
export * from './event-recurrence';
export * from './event-recurrence-rule';

export const EVENTS_LIST_LIMIT = 1000;

/**
 * Wire shape of a calendar event: dates as ISO strings, everything else as
 * stored. Both event routes carried an identical copy.
 */
export function serializeWgEvent(row: typeof wgEvents.$inferSelect) {
	return {
		id: row.id,
		wgId: row.wgId,
		title: row.title,
		description: row.description,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt ? row.endsAt.toISOString() : null,
		allDay: row.allDay,
		location: row.location,
		recurrence: row.recurrence,
		createdByMemberId: row.createdByMemberId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type SerializedWgEvent = ReturnType<typeof serializeWgEvent>;

type EventFormValidation =
	| { ok: true; startsAt: Date; endsAt: Date | null }
	| { ok: false; error: string; field: 'title' | 'startsAt' | 'endsAt' };

export function normalizeEventDateTime(value: string, allDay: boolean): string {
	if (!allDay || value.length < 10) return value;
	return `${value.slice(0, 10)}T00:00`;
}

/**
 * The three checks both event modals ran before submitting, in the order they
 * report them. Pure, so the rules can be tested without rendering a dialog.
 */
export function validateEventForm(input: {
	title: string;
	startsAt: string;
	endsAt: string;
	allDay?: boolean;
	original?: Pick<EventInput, 'startsAt' | 'endsAt' | 'allDay'>;
}): EventFormValidation {
	if (input.title.trim().length === 0) {
		return { ok: false, error: 'Titel fehlt.', field: 'title' };
	}
	if (!input.startsAt) {
		return { ok: false, error: 'Startzeitpunkt fehlt.', field: 'startsAt' };
	}

	const allDay = input.allDay === true;
	const startsAt = new Date(
		`${normalizeEventDateTime(input.startsAt, allDay)}${allDay ? 'Z' : ''}`,
	);
	const endsAt = input.endsAt
		? new Date(`${normalizeEventDateTime(input.endsAt, allDay)}${allDay ? 'Z' : ''}`)
		: null;
	if (!isEventYearInRange(startsAt)) {
		return { ok: false, error: 'Startdatum ist ungültig.', field: 'startsAt' };
	}
	if (endsAt && !isEventYearInRange(endsAt)) {
		return { ok: false, error: 'Enddatum ist ungültig.', field: 'endsAt' };
	}
	if (endsAt && endsAt.getTime() < startsAt.getTime()) {
		return { ok: false, error: 'Endzeit liegt vor Startzeit.', field: 'endsAt' };
	}
	const original = input.original;
	if (
		allDay &&
		original?.allDay &&
		isSameDay(
			eventDateForDisplay(startsAt.toISOString(), true),
			eventDateForDisplay(original.startsAt, true),
		) &&
		(endsAt && original.endsAt
			? isSameDay(
					eventDateForDisplay(endsAt.toISOString(), true),
					eventDateForDisplay(original.endsAt, true),
				)
			: endsAt === null && original.endsAt === null)
	) {
		// Preserve both legacy instants when only title/metadata changed. An explicit
		// date edit writes the pair canonically, avoiding mixed old/new end ordering.
		return {
			ok: true,
			startsAt: new Date(original.startsAt),
			endsAt: original.endsAt ? new Date(original.endsAt) : null,
		};
	}
	return { ok: true, startsAt, endsAt };
}
