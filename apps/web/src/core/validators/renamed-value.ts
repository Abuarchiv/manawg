import { z } from 'zod';

/**
 * An enum that also takes the German keys stored before migration 0039 and reads them as their
 * English key. Offline queues written by an older app version and API clients such as the MCP
 * server may still send the German keys.
 */
export function enumWithRenames<const T extends readonly [string, ...string[]]>(
	values: T,
	renames: Readonly<Record<string, T[number]>>,
) {
	return z.preprocess(
		(value) =>
			typeof value === 'string' && Object.hasOwn(renames, value) ? renames[value] : value,
		z.enum(values),
	);
}
