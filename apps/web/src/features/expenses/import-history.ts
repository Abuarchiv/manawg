import { db, expenseImports } from '@/core/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { findSettledImportIds } from './import-settled';

const CANDIDATE_LIMIT = 50;
const HISTORY_LIMIT = 10;

export interface ImportHistoryEntry {
	id: string;
	source: string;
	startedAt: Date;
	inserted: number;
	importedByMemberId: string | null;
}

/**
 * The newest imports that `mayList` allows and that `undoImport` accepts: no payment completed
 * since the import between its members and no share of a non-payer settled. Imports that fail these checks are
 * skipped before the limit, so they cannot crowd an undoable import out of the list.
 */
export async function listUndoableImports(
	wgId: string,
	mayList: (importedByMemberId: string | null) => boolean,
): Promise<ImportHistoryEntry[]> {
	const rows = await db
		.select({
			id: expenseImports.id,
			source: expenseImports.source,
			startedAt: expenseImports.startedAt,
			inserted: expenseImports.rowCountInserted,
			importedByMemberId: expenseImports.importedByMemberId,
		})
		.from(expenseImports)
		.where(and(eq(expenseImports.wgId, wgId), gt(expenseImports.rowCountInserted, 0)))
		.orderBy(desc(expenseImports.startedAt))
		.limit(CANDIDATE_LIMIT);
	const candidates = rows.filter((row) => mayList(row.importedByMemberId));
	if (candidates.length === 0) return [];

	const settled = await findSettledImportIds(db, wgId, candidates);
	return candidates.filter((row) => !settled.has(row.id)).slice(0, HISTORY_LIMIT);
}
