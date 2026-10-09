import type { StoredImageObject } from '@/core/infra/supabase-storage';

/** A picture may sit in an unsent draft or an offline queue for a while before its row exists. */
export const ORPHAN_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The stored pictures old enough, unreferenced and not already queued for deletion. */
export function selectOrphanKeys(
	objects: readonly StoredImageObject[],
	referenced: ReadonlySet<string>,
	queued: ReadonlySet<string>,
	now: Date,
): string[] {
	const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS;
	return objects
		.filter(
			({ key, createdAt }) =>
				createdAt.getTime() < cutoff && !referenced.has(key) && !queued.has(key),
		)
		.map(({ key }) => key);
}
