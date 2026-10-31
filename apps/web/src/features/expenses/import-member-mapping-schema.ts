import { z } from 'zod';
import { isRecord } from '@/core/utils/is-record';

export function importMemberMappingSchema<T extends z.ZodTypeAny>(valueSchema: T) {
	// Names such as __proto__ are data keys; Zod records would drop them.
	return z
		.preprocess(
			(value) => (isRecord(value) ? new Map(Object.entries(value)) : null),
			z.map(z.string(), valueSchema),
		)
		.transform((entries) => Object.fromEntries(entries));
}
