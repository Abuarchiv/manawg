import { MS_PER_DAY } from '@/core/utils/time';

// Free of zod, so client code can check a picked date without shipping the schema library.
//
// nextDueAt drives the cron's catch-up loop (one iteration per missed
// interval). An unbounded past date would translate into an unbounded
// charge storm, and a nonsensical far-future date would silently park the
// template; both are rejected on create and whenever an edit moves the
// due date.
const MAX_PAST_DAYS = 366;
const MAX_FUTURE_DAYS = 3650;

export function isRecurringDueAtInRange(value: string): boolean {
	const parsed = Date.parse(value);
	if (Number.isNaN(parsed)) return false;
	const skew = Date.now() - parsed;
	return skew <= MAX_PAST_DAYS * MS_PER_DAY && skew >= -MAX_FUTURE_DAYS * MS_PER_DAY;
}
