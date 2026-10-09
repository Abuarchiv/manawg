import { db, expenseImports } from '@/core/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { findSettledImportIds } from './import-settled';

const BATCH_SIZE = 50;
const HISTORY_LIMIT = 10;

export interface ImportHistoryEntry {
	id: string;
	source: string;
	startedAt: Date;
	inserted: number;
	importedByMemberId: string | null;
}

/**
 * The newest imports that `undoImport` accepts: no payment completed since the import between
 * its members and no share of a non-payer settled. `onlyMemberId` limits the list to that
 * member's own imports (an admin passes null). Imports that fail the checks are skipped while
 * paging back through the history, so they cannot crowd an undoable import out of the list.
 */
export async function listUndoableImports(
	wgId: string,
	onlyMemberId: string | null,
): Promise<ImportHistoryEntry[]> {
	const found: ImportHistoryEntry[] = [];
	for (let batch = 0; found.length < HISTORY_LIMIT; batch += 1) {
		const rows = await db
			.select({
				id: expenseImports.id,
				source: expenseImports.source,
				startedAt: expenseImports.startedAt,
				inserted: expenseImports.rowCountInserted,
				importedByMemberId: expenseImports.importedByMemberId,
			})
			.from(expenseImports)
			.where(
				and(
					eq(expenseImports.wgId, wgId),
					gt(expenseImports.rowCountInserted, 0),
					onlyMemberId ? eq(expenseImports.importedByMemberId, onlyMemberId) : undefined,
				),
			)
			.orderBy(desc(expenseImports.startedAt), desc(expenseImports.id))
			.limit(BATCH_SIZE)
			.offset(batch * BATCH_SIZE);
		const settled = await findSettledImportIds(db, wgId, rows);
		found.push(...rows.filter((row) => !settled.has(row.id)));
		if (rows.length < BATCH_SIZE) break;
	}
	return found.slice(0, HISTORY_LIMIT);
}
