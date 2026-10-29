import { z } from 'zod';

/** The time a client reports for a tap or a write; callers clamp it with `clampTapTime`. */
export const tapTimeSchema = z
	.string()
	.refine((value) => Number.isFinite(Date.parse(value)))
	.transform((value) => new Date(value));
