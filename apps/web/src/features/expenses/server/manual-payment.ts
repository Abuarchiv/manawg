import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { auditValues } from '@/core/audit-values';
import { auditEvents, expensePayments, wgMembers } from '@/core/db';
import { responseCodec, type WriteOutcome } from '@/core/db/idempotent-write';
import type { DbTransaction } from '@/core/db/transaction';
import { HTTP } from '@/core/http/api-errors';
import { currencySchema } from '@/core/validators/currency';
import { loadSettlementSnapshot, pairIsInWg } from '@/features/expenses/server/settle-debt';
import { selectSettlementScope } from '@/features/expenses/settlement-scope';

/** Largest amount the payment column holds (PostgreSQL integer). */
const PAYMENT_AMOUNT_MAX_CENTS = 2_147_483_647;

/** A cash payment between two members, entered by one of them after the money changed hands. */
export const manualPaymentSchema = z
	.object({
		fromMemberId: z.string().uuid(),
		toMemberId: z.string().uuid(),
		currency: currencySchema.default('EUR'),
		/** The net debt the person reviewed; the payment is refused unless it still matches. */
		// Within the integer column of `expense_payments.amount_cents`.
		expectedNetCents: z.number().int().positive().max(PAYMENT_AMOUNT_MAX_CENTS),
	})
	.strict();

export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export const manualPaymentCodec = responseCodec();
export const voidCashPaymentCodec = responseCodec();

type RecordOutcome =
	| { kind: 'member_deactivated' }
	| { kind: 'member_not_in_wg' }
	| { kind: 'changed' }
	| { kind: 'recorded'; paymentId: string; amountCents: number };

type VoidOutcome =
	| { kind: 'member_deactivated' | 'not_found' | 'not_party' | 'already_voided' }
	| { kind: 'voided'; otherMemberId: string; amountCents: number; currency: string };

const REJECTION_STATUS: Record<string, number> = {
	member_deactivated: HTTP.UNAUTHORIZED,
	member_not_in_wg: HTTP.BAD_REQUEST,
	not_found: HTTP.NOT_FOUND,
	not_party: HTTP.FORBIDDEN,
};

/** Rejections are answered by the route and not stored, so the same key can run again. */
function rejected<K extends string>(kind: K): WriteOutcome<unknown, { kind: K }> {
	return { status: REJECTION_STATUS[kind] ?? HTTP.CONFLICT, body: null, context: { kind } };
}

/** Lock the acting member's row; a member who moved out cannot write. */
async function lockActiveCaller(tx: DbTransaction, wgId: string, callerId: string) {
	const [activeCaller] = await tx
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(eq(wgMembers.id, callerId), eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)),
		)
		.limit(1)
		.for('update');
	return activeCaller;
}

/**
 * Record a completed cash payment for the whole current net debt of the pair. Run it under the
 * WG's payment lock: the net amount is recomputed here, so a payment entered against an amount
 * that has since changed is refused instead of leaving a hidden remainder.
 */
export async function recordCashPayment(
	tx: DbTransaction,
	wgId: string,
	callerId: string,
	input: ManualPaymentInput,
	callerName = '',
): Promise<WriteOutcome<unknown, RecordOutcome>> {
	if (!(await lockActiveCaller(tx, wgId, callerId))) return rejected('member_deactivated');

	const snapshot = await loadSettlementSnapshot(tx, wgId);
	if (!pairIsInWg(snapshot, input.fromMemberId, input.toMemberId)) {
		return rejected('member_not_in_wg');
	}

	const preview = selectSettlementScope(
		snapshot.expenses,
		snapshot.members,
		snapshot.payments,
		input.fromMemberId,
		input.toMemberId,
		input.currency,
	);
	if (preview.netCents <= 0 || preview.netCents !== input.expectedNetCents) {
		return rejected('changed');
	}

	const [payment] = await tx
		.insert(expensePayments)
		.values({
			wgId,
			fromMemberId: input.fromMemberId,
			toMemberId: input.toMemberId,
			amountCents: preview.netCents,
			currency: preview.currency,
			status: 'completed',
			completedAt: new Date(),
		})
		.returning({ id: expensePayments.id });
	if (!payment) throw new Error('manual_payment_insert_failed');
	// Written with the payment, so a replayed request never finds a payment without its author.
	await tx.insert(auditEvents).values(
		auditValues({
			wgId,
			memberId: callerId,
			eventType: 'expense.debt.settled.manual',
			entityType: 'expense_payment',
			entityId: payment.id,
			actorName: callerName,
			metadata: {
				fromMemberId: input.fromMemberId,
				toMemberId: input.toMemberId,
				amountCents: preview.netCents,
				currency: preview.currency,
			},
		}),
	);
	return {
		status: 200,
		body: {
			paymentId: payment.id,
			amountCents: preview.netCents,
			currency: preview.currency,
			debtor: input.fromMemberId,
			creditor: input.toMemberId,
		},
		context: { kind: 'recorded', paymentId: payment.id, amountCents: preview.netCents },
	};
}

/**
 * Void a completed cash payment. The status flip takes it out of every balance, debt and statement
 * because all of them read only `completed` payments; correcting a payment means voiding it and
 * entering it again. Run it under the WG's payment lock.
 */
export async function voidCashPayment(
	tx: DbTransaction,
	wgId: string,
	callerId: string,
	paymentId: string,
	callerName = '',
): Promise<WriteOutcome<unknown, VoidOutcome>> {
	if (!(await lockActiveCaller(tx, wgId, callerId))) return rejected('member_deactivated');

	const [payment] = await tx
		.select({
			fromMemberId: expensePayments.fromMemberId,
			toMemberId: expensePayments.toMemberId,
			amountCents: expensePayments.amountCents,
			currency: expensePayments.currency,
			status: expensePayments.status,
		})
		.from(expensePayments)
		.where(and(eq(expensePayments.id, paymentId), eq(expensePayments.wgId, wgId)))
		.limit(1)
		.for('update');
	if (!payment) return rejected('not_found');
	if (callerId !== payment.fromMemberId && callerId !== payment.toMemberId) {
		return rejected('not_party');
	}
	if (payment.status !== 'completed') return rejected('already_voided');

	await tx
		.update(expensePayments)
		.set({ status: 'voided' })
		.where(and(eq(expensePayments.id, paymentId), eq(expensePayments.status, 'completed')));
	// Written with the status change, so the feed shows who voided it and when.
	await tx.insert(auditEvents).values(
		auditValues({
			wgId,
			memberId: callerId,
			eventType: 'expense.debt.settled.manual.voided',
			entityType: 'expense_payment',
			entityId: paymentId,
			actorName: callerName,
			metadata: {
				fromMemberId: payment.fromMemberId,
				toMemberId: payment.toMemberId,
				amountCents: payment.amountCents,
				currency: payment.currency,
			},
		}),
	);
	return {
		status: 200,
		body: { paymentId, voided: true, amountCents: payment.amountCents, currency: payment.currency },
		context: {
			kind: 'voided',
			otherMemberId: payment.fromMemberId === callerId ? payment.toMemberId : payment.fromMemberId,
			amountCents: payment.amountCents,
			currency: payment.currency,
		},
	};
}
