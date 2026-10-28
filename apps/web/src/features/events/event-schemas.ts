import { z } from 'zod';
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
