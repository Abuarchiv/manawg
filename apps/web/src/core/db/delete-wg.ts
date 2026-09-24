import { eq } from 'drizzle-orm';
import {
	announcements,
	chores,
	expensePayments,
	expenses,
	recurringExpenses,
	shoppingItems,
	wgs,
} from './schema';
import type { DbTransaction } from './transaction';

/**
 * Deletes a WG and everything it owns. Several historical/member references
 * intentionally use RESTRICT so a member cannot be hard-deleted while its
 * accounting history remains. Whole-WG deletion is the explicit destructive
 * operation, so remove those WG-owned roots first and let the remaining WG
 * cascades clean up comments, splits, logs, and subscriptions.
 */
export async function deleteWgCascade(tx: DbTransaction, wgId: string): Promise<boolean> {
	await tx.delete(expenses).where(eq(expenses.wgId, wgId));
	await tx.delete(expensePayments).where(eq(expensePayments.wgId, wgId));
	await tx.delete(shoppingItems).where(eq(shoppingItems.wgId, wgId));
	await tx.delete(announcements).where(eq(announcements.wgId, wgId));
	await tx.delete(chores).where(eq(chores.wgId, wgId));
	await tx.delete(recurringExpenses).where(eq(recurringExpenses.wgId, wgId));
	const deleted = await tx.delete(wgs).where(eq(wgs.id, wgId)).returning({ id: wgs.id });
	return deleted.length > 0;
}
