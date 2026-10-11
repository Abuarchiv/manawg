import { isYearInRange } from '@/shared/lib/limits';

/** Field limits shared by the event form and the event API routes. */
export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 2_000;
export const EVENT_LOCATION_MAX = 200;
/** Room for the rule head and 1,500 single-occurrence exceptions of about 25 characters each. */
export const EVENT_RECURRENCE_MAX = 40_000;

export const isEventYearInRange = isYearInRange;
