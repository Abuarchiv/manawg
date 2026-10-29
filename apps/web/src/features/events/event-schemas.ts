import { z } from 'zod';
import { berlinDayKey } from '@/core/utils/berlin-day';
import {
	EVENT_DESCRIPTION_MAX,
	EVENT_LOCATION_MAX,
	EVENT_RECURRENCE_MAX,
	EVENT_TITLE_MAX,
	isEventYearInRange,
} from '@/features/events/event-limits';

/** Field schemas shared by event create (POST) and edit (PATCH). */
export const eventTitleSchema = z.string().trim().min(1).max(EVENT_TITLE_MAX);
export const eventDescriptionSchema = z.string().trim().max(EVENT_DESCRIPTION_MAX).nullable();
export const eventLocationSchema = z.string().trim().max(EVENT_LOCATION_MAX).nullable();
export const eventRecurrenceSchema = z.string().trim().max(EVENT_RECURRENCE_MAX).nullable();
export const eventDateTimeSchema = z
	.string()
	.datetime({ offset: true })
	.refine((value) => isEventYearInRange(new Date(value)));

/**
 * The stored instant of an event time. An all-day event is stored as UTC midnight of its date, so
 * every device shows the same day: the date as written when the sender gave its own offset, else
 * the Berlin date of the instant (as migration 0039 rewrote older rows).
 */
export function eventInstant(value: string, allDay: boolean): Date {
	if (!allDay) return new Date(value);
	const utc = /(Z|[+-]00:?00)$/i.test(value);
	return new Date(`${utc ? berlinDayKey(new Date(value)) : value.slice(0, 10)}T00:00:00Z`);
}
