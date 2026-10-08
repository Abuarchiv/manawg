import { expenseImports, expensePayments, expenseSplits, expenses } from '@/core/db';
import { TransactionAbort } from '@/core/db/transaction';
import { and, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';
import { hasCapturingExpensePayment, withExpensePaymentLock } from './expense-payments';

export type UndoImportResult =
	| { ok: true; removed: number; source: string; importedByMemberId: string | null }
	| {
			ok: false;
			error: 'import_not_found' | 'not_allowed' | 'import_settled' | 'paypal_payment_pending';
	  };

/**
 * Removes every expense an import created, then the import record. Refused once any share of
 * it is paid, because deleting it would undo money that already moved between members.
 */
export async function undoImport(
	wgId: string,
	importId: string,
	mayUndo: (importedByMemberId: string | null) => Promise<boolean>,
): Promise<UndoImportResult> {
	try {
		return await withExpensePaymentLock(wgId, async (tx) => {
			const [imp] = await tx
				.select({
					source: expenseImports.source,
					importedBy: expenseImports.importedByMemberId,
					startedAt: expenseImports.startedAt,
				})
				.from(expenseImports)
				.where(and(eq(expenseImports.id, importId), eq(expenseImports.wgId, wgId)))
				.limit(1);
			if (!imp) return { ok: false as const, error: 'import_not_found' as const };
			if (!(await mayUndo(imp.importedBy))) {
				return { ok: false as const, error: 'not_allowed' as const };
			}
			if (await hasCapturingExpensePayment(tx, wgId)) {
				throw new TransactionAbort('paypal_payment_pending');
			}

			// A payment completed since the import may have covered its expenses through a netted
			// balance; which of them is not recoverable, so any such payment blocks the undo.
			const [laterPayment] = await tx
				.select({ id: expensePayments.id })
				.from(expensePayments)
				.where(
					and(
						eq(expensePayments.wgId, wgId),
						eq(expensePayments.status, 'completed'),
						gte(expensePayments.completedAt, imp.startedAt),
					),
				)
				.limit(1);
			if (laterPayment) return { ok: false as const, error: 'import_settled' as const };

			const rows = await tx
				.select({ id: expenses.id })
				.from(expenses)
				.where(and(eq(expenses.wgId, wgId), eq(expenses.importId, importId)));
			const ids = rows.map((row) => row.id);
			if (ids.length > 0) {
				// A payer's own share is settled from the start; anyone else's means money moved.
				const [paid] = await tx
					.select({ id: expenseSplits.id })
					.from(expenseSplits)
					.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
					.where(
						and(
							inArray(expenseSplits.expenseId, ids),
							isNotNull(expenseSplits.settledAt),
							ne(expenseSplits.debtorMemberId, expenses.paidByMemberId),
						),
					)
					.limit(1);
				if (paid) return { ok: false as const, error: 'import_settled' as const };
				await tx.delete(expenses).where(inArray(expenses.id, ids));
			}
			await tx.delete(expenseImports).where(eq(expenseImports.id, importId));
			return {
				ok: true as const,
				removed: ids.length,
				source: imp.source,
				importedByMemberId: imp.importedBy,
			};
		});
	} catch (err) {
		if (err instanceof TransactionAbort && err.code === 'paypal_payment_pending') {
			return { ok: false, error: 'paypal_payment_pending' };
		}
		throw err;
	}
}
