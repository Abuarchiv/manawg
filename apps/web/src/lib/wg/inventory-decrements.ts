import { db, wgInventoryLog } from '@/lib/db';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';

const DEFAULT_DECREMENT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function getRecentDecrementCount(
	itemId: string,
	days: number = DEFAULT_DECREMENT_WINDOW_DAYS,
): Promise<number> {
	const since = new Date(Date.now() - days * MS_PER_DAY);
	const rows = await db
		.select({ delta: wgInventoryLog.delta })
		.from(wgInventoryLog)
		.where(
			and(
				eq(wgInventoryLog.itemId, itemId),
				eq(wgInventoryLog.kind, 'consume'),
				gte(wgInventoryLog.createdAt, since),
				lt(wgInventoryLog.delta, 0),
			),
		);
	return rows.length;
}

export async function getRecentDecrementCounts(
	itemIds: readonly string[],
	days: number = DEFAULT_DECREMENT_WINDOW_DAYS,
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	for (const id of itemIds) counts.set(id, 0);
	if (itemIds.length === 0) return counts;
	const since = new Date(Date.now() - days * MS_PER_DAY);
	const rows = await db
		.select({ itemId: wgInventoryLog.itemId, delta: wgInventoryLog.delta })
		.from(wgInventoryLog)
		.where(
			and(
				inArray(wgInventoryLog.itemId, [...itemIds]),
				eq(wgInventoryLog.kind, 'consume'),
				gte(wgInventoryLog.createdAt, since),
				lt(wgInventoryLog.delta, 0),
			),
		);
	for (const row of rows) {
		counts.set(row.itemId, (counts.get(row.itemId) ?? 0) + 1);
	}
	return counts;
}
