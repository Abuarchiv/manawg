import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, expensePayments } from '@/core/db';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';

export async function loadCompletedExpensePayments(
	wgId: string,
	client: typeof db | DbTransaction = db,
): Promise<ExpensePaymentInput[]> {
	const rows = await client
		.select({
			id: expensePayments.id,
			fromMemberId: expensePayments.fromMemberId,
			toMemberId: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
			completedAt: expensePayments.completedAt,
		})
		.from(expensePayments)
		.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed')));
	return rows.map((row) => ({ ...row, completedAt: row.completedAt?.toISOString() ?? null }));
}

export async function withExpensePaymentLock<T>(
	wgId: string,
	fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
	return withTransaction(async (tx) => {
		// One advisory lock per WG serialises all expense, split and payment writers.
		// wgId is always a resolved wgs.id, never a URL parameter.
		await lockExpensePayments(tx, wgId);
		return fn(tx);
	});
}
