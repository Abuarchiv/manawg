import 'server-only';

import { db } from '@/core/db';
import { wgs } from '@/core/db/schema';
import { listSupabaseImageObjects, removeSupabaseImages } from '@/core/infra/supabase-storage';
import type { StoredImageObject } from '@/core/infra/supabase-storage';
import { asc } from 'drizzle-orm';
import { selectOrphanKeys } from './orphan-upload-selection';
import { findQueuedImageDeletionKeys, findWgReferencedImageKeys } from './private-image-deletions';

const PURPOSES = ['expense', 'announcement', 'chat'] as const;
const WGS_PER_RUN = 10;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Removes uploaded pictures no row points at: a visitor picked a picture and then dropped the
 * form. A run looks at a few WGs and the next run at the following ones, so the whole bucket
 * is covered over time without one run having to list all of it.
 */
export async function sweepOrphanUploads(now = new Date()): Promise<{
	wgsChecked: number;
	removed: number;
}> {
	const rows = await db.select({ id: wgs.id }).from(wgs).orderBy(asc(wgs.id));
	if (rows.length === 0) return { wgsChecked: 0, removed: 0 };
	const start = (Math.floor(now.getTime() / HOUR_MS) * WGS_PER_RUN) % rows.length;
	const batch = Array.from(
		{ length: Math.min(WGS_PER_RUN, rows.length) },
		(_, index) => rows[(start + index) % rows.length],
	);

	let removed = 0;
	for (const row of batch) {
		if (!row) continue;
		const objects: StoredImageObject[] = [];
		for (const purpose of PURPOSES) {
			objects.push(...(await listSupabaseImageObjects(`manawg/${row.id}/${purpose}`)));
		}
		if (objects.length === 0) continue;
		const referenced = await findWgReferencedImageKeys(row.id);
		const queued = await findQueuedImageDeletionKeys(objects.map(({ key }) => key));
		const orphans = selectOrphanKeys(objects, referenced, queued, now);
		if (orphans.length === 0) continue;
		await removeSupabaseImages(orphans);
		removed += orphans.length;
	}
	return { wgsChecked: batch.length, removed };
}
