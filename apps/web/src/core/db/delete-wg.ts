import { eq, inArray, sql } from 'drizzle-orm';
import { recordWgImageDeletions } from './private-image-deletions';
import {
	announcements,
	auditEvents,
	chores,
	expensePayments,
	expenses,
	recurringExpenses,
	shoppingItems,
	wgChatMessages,
	wgs,
} from './schema';
import { wgInventoryItems, wgInventoryLog } from './schema-inventory';
import { type DbTransaction, lockExpensePayments } from './transaction';

const WG_DELETE_TIMEOUT_MS = 60_000;

/**
 * Deletes a WG and everything it owns. Several historical/member references
 * intentionally use RESTRICT so a member cannot be hard-deleted while its
 * accounting history remains. Whole-WG deletion is the explicit destructive
 * operation, so remove those WG-owned roots first and let the remaining WG
 * cascades clean up comments, splits, logs, and subscriptions.
 */
export async function deleteWgCascade(tx: DbTransaction, wgId: string): Promise<boolean> {
	await lockExpensePayments(tx, wgId);
	const [wg] = await tx.select({ id: wgs.id }).from(wgs).where(eq(wgs.id, wgId)).for('update');
	if (!wg) return false;
	await recordWgImageDeletions(tx, wgId);
	// The pool's 5 s statement_timeout would abort the final cascade of a large WG, so it could
	// never be deleted. Raise it for this transaction only and clear the biggest child tables
	// first, as separate statements, so the closing `delete from wgs` has little left to cascade.
	await tx.execute(sql.raw(`set local statement_timeout = '${WG_DELETE_TIMEOUT_MS} ms'`));
	// pg's own read deadline (query_timeout 5.5 s) would still end the connection first, so
	// the client must wait longer than the server does.
	const restoreReadTimeout = raiseClientReadTimeout(tx, WG_DELETE_TIMEOUT_MS + 1_000);
	try {
		return await deleteWgRows(tx, wgId);
	} finally {
		restoreReadTimeout();
	}
}

/**
 * Sets the client-side read deadline of the transaction's pooled connection and returns
 * the undo; the connection goes back to the pool afterwards and must not keep it.
 */
function raiseClientReadTimeout(tx: DbTransaction, ms: number): () => void {
	const params = (
		tx as {
			session?: { client?: { connectionParameters?: { query_timeout?: number | undefined } } };
		}
	).session?.client?.connectionParameters;
	if (!params) return () => {};
	const previous = params.query_timeout;
	params.query_timeout = ms;
	return () => {
		params.query_timeout = previous;
	};
}

async function deleteWgRows(tx: DbTransaction, wgId: string): Promise<boolean> {
	await tx.delete(wgChatMessages).where(eq(wgChatMessages.wgId, wgId));
	await tx.delete(auditEvents).where(eq(auditEvents.wgId, wgId));
	await tx
		.delete(wgInventoryLog)
		.where(
			inArray(
				wgInventoryLog.itemId,
				tx
					.select({ id: wgInventoryItems.id })
					.from(wgInventoryItems)
					.where(eq(wgInventoryItems.wgId, wgId)),
			),
		);
	await tx.delete(expenses).where(eq(expenses.wgId, wgId));
	await tx.delete(expensePayments).where(eq(expensePayments.wgId, wgId));
	await tx.delete(shoppingItems).where(eq(shoppingItems.wgId, wgId));
	await tx.delete(announcements).where(eq(announcements.wgId, wgId));
	await tx.delete(chores).where(eq(chores.wgId, wgId));
	await tx.delete(recurringExpenses).where(eq(recurringExpenses.wgId, wgId));
	const deleted = await tx.delete(wgs).where(eq(wgs.id, wgId)).returning({ id: wgs.id });
	return deleted.length > 0;
}
