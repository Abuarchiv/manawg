import { z } from 'zod';
import { isYearInRange } from '@/shared/lib/limits';

export const CHORE_TITLE_MIN = 1;
export const CHORE_TITLE_MAX = 120;
export const ABSENCE_REASON_MAX = 120;
export const CHORE_INTERVAL_MIN = 1;
// Cap depends on unit: 365 days or 60 months (5 years), both reasonable for a WG.
export const CHORE_INTERVAL_MAX_DAYS = 365;
export const CHORE_INTERVAL_MAX_MONTHS = 60;

/** Due dates outside the supported year range would make the Berlin-day math throw. */
export const choreDueAtSchema = z
	.string()
	.datetime({ offset: true })
	.refine((value) => isYearInRange(new Date(value)));
