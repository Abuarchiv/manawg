import { z } from 'zod';
import { MS_PER_DAY } from '@/core/utils/time';
import { isRecurringDueAtInRange } from './recurring-due-range';

/**
 * Whether an edit may set the template's due date to `value`. The edit
 * form always resends the current due date, so an unchanged value is
 * accepted even when it has drifted out of range (e.g. a long-paused
 * template); only a moved due date has to be in range.
 */
export function isRecurringDueAtEditAllowed(value: string, currentDueAt: Date): boolean {
	return Date.parse(value) === currentDueAt.getTime() || isRecurringDueAtInRange(value);
}

export const recurringDueAtSchema = z
	.string()
	.datetime({ offset: true })
	.refine(isRecurringDueAtInRange, { message: 'due_date_out_of_range' });

/** Longest interval a template supports, plus slack for month-length clamping. */
const MAX_ANCHOR_LEAD_DAYS = 24 * 31 + 1;

/**
 * Whether `anchorAt` can be the start of a template first due at `nextDueAt`.
 * Only its day-of-month matters to later due dates, so it merely has to lie
 * shortly before the first due date.
 */
export function isRecurringAnchorAllowed(
	anchorAt: string,
	nextDueAt: string,
	maxLeadDays = MAX_ANCHOR_LEAD_DAYS,
): boolean {
	const anchor = Date.parse(anchorAt);
	const due = Date.parse(nextDueAt);
	if (Number.isNaN(anchor) || Number.isNaN(due)) return false;
	return anchor <= due && due - anchor <= maxLeadDays * MS_PER_DAY;
}
