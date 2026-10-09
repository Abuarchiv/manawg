import {
	AMOUNT_MAX_CENTS,
	AMOUNT_MIN_CENTS,
	DESCRIPTION_MAX_LENGTH,
} from '@/features/expenses/expense-constants';
import { z } from 'zod';

/**
 * Request-body building blocks shared by the expense and recurring-expense
 * routes, so a limit changed in one place applies to every write path.
 */

/** One debtor's share. Zero is allowed: a member can be part of a split without owing. */
export const expenseSplitSchema = z.object({
	debtorMemberId: z.string().uuid(),
	amountCents: z
		.number()
		.int('amountCents must be an integer')
		.min(0, 'amountCents must not be negative'),
});

export const expenseAmountSchema = z
	.number()
	.int('amountCents must be an integer')
	.min(AMOUNT_MIN_CENTS)
	.max(AMOUNT_MAX_CENTS);

export const expenseDescriptionSchema = z.string().trim().min(1).max(DESCRIPTION_MAX_LENGTH);

const OCCURRED_AT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const OCCURRED_AT_MAX_PAST_YEARS = 10;

/**
 * Ten calendar years back, from the start of that UTC day minus one more day: the date field
 * sends a day as Berlin noon, so the whole anniversary date stays valid at any time of day.
 */
function oldestAllowedOccurredAt(now: number): number {
	const boundary = new Date(now);
	boundary.setUTCFullYear(boundary.getUTCFullYear() - OCCURRED_AT_MAX_PAST_YEARS);
	boundary.setUTCHours(0, 0, 0, 0);
	return boundary.getTime() - 24 * 60 * 60 * 1000;
}

/** When the expense happened: not later than tomorrow and not older than ten years. */
export const expenseOccurredAtSchema = z
	.string()
	.datetime({ offset: true })
	.refine((value) => {
		const time = Date.parse(value);
		const now = Date.now();
		return time <= now + OCCURRED_AT_MAX_FUTURE_MS && time >= oldestAllowedOccurredAt(now);
	}, 'occurred_at_out_of_range');
