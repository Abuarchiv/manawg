import 'server-only';
import { z } from 'zod';
import { isYearInRange } from '@/shared/lib/limits';

/** Due dates outside the supported year range would make the Berlin-day math throw. */
export const choreDueAtSchema = z
	.string()
	.datetime({ offset: true })
	.refine((value) => isYearInRange(new Date(value)));
