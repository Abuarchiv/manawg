import { db, wgs } from '@/core/db';
import { eq } from 'drizzle-orm';

/**
 * Shape returned by {@link resolveWg}.
 *
 * A WG row, narrowed to the columns the API routes actually consume.
 * If you need a different subset (e.g. just `id`), prefer destructuring at
 * the call site rather than adding a new helper.
 */
export interface ResolvedWg {
	id: string;
	name: string;
	shareCode: string;
}

/**
 * Resolve a share-code to a full WG row ({id, name, shareCode}).
 *
 * Returns `null` when no WG with that share code exists. Routes should not
 * call this directly — use `requireWgMember` from
 * `@/core/guards/require-wg-member`, which combines this lookup with the member
 * check.
 */
export async function resolveWg(code: string): Promise<ResolvedWg | null> {
	const rows = await db
		.select({ id: wgs.id, name: wgs.name, shareCode: wgs.shareCode })
		.from(wgs)
		.where(eq(wgs.shareCode, code))
		.limit(1);
	return rows[0] ?? null;
}
