import { db, expensePayments } from '@/core/db';
import { type DbTransaction, withTransaction } from '@/core/db/transaction';
import { and, eq, gt, or, sql } from 'drizzle-orm';

export const PAYPAL_ORDER_TTL_MS = 3 * 60 * 60 * 1000;

export interface ExpensePaymentInput {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
}

export async function loadCompletedExpensePayments(wgId: string): Promise<ExpensePaymentInput[]> {
	return db
		.select({
			fromMemberId: expensePayments.fromMemberId,
			toMemberId: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
		})
		.from(expensePayments)
		.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'completed')));
}

export function activeExpensePaymentCondition(wgId: string, now = new Date()) {
	return and(
		eq(expensePayments.wgId, wgId),
		or(
			eq(expensePayments.status, 'capturing'),
			and(eq(expensePayments.status, 'created'), gt(expensePayments.expiresAt, now)),
		),
	);
}

export async function hasActiveExpensePayment(
	tx: DbTransaction,
	wgId: string,
	now = new Date(),
): Promise<boolean> {
	const rows = await tx
		.select({ id: expensePayments.id })
		.from(expensePayments)
		.where(activeExpensePaymentCondition(wgId, now))
		.limit(1);
	return rows.length > 0;
}

export async function withExpensePaymentLock<T>(
	wgId: string,
	fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
	return withTransaction(async (tx) => {
		// ponytail: one WG lock keeps settlements coherent; split per pair only if measured contention needs it.
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`expense-payment:${wgId}`}))`);
		return fn(tx);
	});
}
