import { db, expenseImports, expensePayments, expenseSplits, expenses } from '@/core/db';
import { and, desc, eq, gt, inArray, isNotNull, max, ne } from 'drizzle-orm';

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
 * since the import and no share of a non-payer settled. Imports that fail these checks are
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

	const [latest] = await db
		.select({ completedAt: max(expensePayments.completedAt) })
		.from(expensePayments)
		.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed')));
	const settled = await db
		.selectDistinct({ importId: expenses.importId })
		.from(expenseSplits)
		.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
		.where(
			and(
				eq(expenses.wgId, wgId),
				inArray(
					expenses.importId,
					candidates.map((row) => row.id),
				),
				isNotNull(expenseSplits.settledAt),
				ne(expenseSplits.debtorMemberId, expenses.paidByMemberId),
			),
		);
	const settledIds = new Set(settled.map((row) => row.importId));
	const lastPaymentMs = latest?.completedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
	return candidates
		.filter((row) => !settledIds.has(row.id) && row.startedAt.getTime() > lastPaymentMs)
		.slice(0, HISTORY_LIMIT);
}
