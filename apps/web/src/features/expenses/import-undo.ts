import { auditEvents, expenseImports, expenses, wgMembers } from '@/core/db';
import { TransactionAbort } from '@/core/db/transaction';
import { and, eq, inArray } from 'drizzle-orm';
import { hasCapturingExpensePayment, withExpensePaymentLock } from './expense-payments';
import { findSettledImportIds } from './import-settled';

export type UndoImportResult =
	| { ok: true; removed: number; source: string; importedByMemberId: string | null }
	| {
			ok: false;
			error: 'import_not_found' | 'not_allowed' | 'import_settled' | 'paypal_payment_pending';
	  };

/**
 * Removes every expense an import created, then the import record. Refused once any share of
 * it is paid, because deleting it would undo money that already moved between members.
 * The caller is read again under the payment lock: only the member who imported or the admin,
 * still active, may undo, and the audit entry is written with the deletion.
 */
export async function undoImport(
	wgId: string,
	importId: string,
	actor: { memberId: string; name: string },
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
			const [caller] = await tx
				.select({ role: wgMembers.role, deactivatedAt: wgMembers.deactivatedAt })
				.from(wgMembers)
				.where(and(eq(wgMembers.id, actor.memberId), eq(wgMembers.wgId, wgId)))
				.limit(1);
			const mayUndo =
				caller !== undefined &&
				caller.deactivatedAt === null &&
				(imp.importedBy === actor.memberId || caller.role === 'admin');
			if (!mayUndo) return { ok: false as const, error: 'not_allowed' as const };
			if (await hasCapturingExpensePayment(tx, wgId)) {
				throw new TransactionAbort('paypal_payment_pending');
			}

			const settled = await findSettledImportIds(tx, wgId, [
				{ id: importId, startedAt: imp.startedAt },
			]);
			if (settled.has(importId)) return { ok: false as const, error: 'import_settled' as const };

			const rows = await tx
				.select({ id: expenses.id })
				.from(expenses)
				.where(and(eq(expenses.wgId, wgId), eq(expenses.importId, importId)));
			const ids = rows.map((row) => row.id);
			if (ids.length > 0) {
				await tx.delete(expenses).where(inArray(expenses.id, ids));
			}
			await tx.delete(expenseImports).where(eq(expenseImports.id, importId));
			await tx.insert(auditEvents).values({
				wgId,
				memberId: actor.memberId,
				eventType: 'import.undone',
				entityType: 'expense_import',
				entityId: importId,
				summary: `${actor.name} hat einen Import rückgängig gemacht (${ids.length} ${ids.length === 1 ? 'Ausgabe' : 'Ausgaben'}).`,
				metadataJson: JSON.stringify({ source: imp.source, removed: ids.length }),
			});
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
