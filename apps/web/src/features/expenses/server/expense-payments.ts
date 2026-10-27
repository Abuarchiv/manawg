import 'server-only';
import { db, expensePayments } from '@/core/db';
import { type DbTransaction, lockExpensePayments, withTransaction } from '@/core/db/transaction';
import { afterResponse } from '@/core/infra/after-response';
import { isPayPalConfigured } from '@/core/infra/paypal';
import type { ExpensePaymentInput } from '@/features/expenses/expense-payment-input';
import { and, eq, gt, or } from 'drizzle-orm';

export const PAYPAL_ORDER_TTL_MS = 3 * 60 * 60 * 1000;
/** A `capturing` row older than this is stuck; the payer's own capture call would have ended. */
export const STALE_CAPTURE_MS = 15 * 60 * 1000;

export async function loadCompletedExpensePayments(
	wgId: string,
	client: typeof db | DbTransaction = db,
): Promise<ExpensePaymentInput[]> {
	const rows = await client
		.select({
			id: expensePayments.id,
			provider: expensePayments.provider,
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

function activeExpensePaymentCondition(wgId: string, now = new Date()) {
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

export async function hasCapturingExpensePayment(
	tx: DbTransaction,
	wgId: string,
): Promise<boolean> {
	const rows = await tx
		.select({ id: expensePayments.id, createdAt: expensePayments.createdAt })
		.from(expensePayments)
		.where(and(eq(expensePayments.wgId, wgId), eq(expensePayments.status, 'capturing')))
		.limit(1);
	const createdAt = rows[0]?.createdAt;
	// A stuck capture blocks every money write of the WG; resolve it now instead of
	// waiting for the nightly maintenance run. It needs this lock, so it runs afterwards.
	if (createdAt && Date.now() - createdAt.getTime() > STALE_CAPTURE_MS && isPayPalConfigured()) {
		afterResponse(async () => {
			const { reconcileStaleCapturingPayments } = await import('./paypal-reconcile');
			await reconcileStaleCapturingPayments(new Date(), wgId);
		});
	}
	return rows.length > 0;
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
