import 'server-only';
import { db, expensePayments } from '@/core/db';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import { and, eq } from 'drizzle-orm';

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
		// All expense, split, and payment writers use this lock before their
		// accounting transaction.
		//
		// wgId is always a DB UUID here — every caller resolves it from a WG
		// row selected by share code (see app/api/wg/[code]/*/route.ts) or
		// from a `wgs.id` column. It is never a raw URL parameter, so the
		// advisory lock key is safe from injection and collisions.
		await lockExpensePayments(tx, wgId);
		return fn(tx);
	});
}
