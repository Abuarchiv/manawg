import { auditEvents, expensePayments, wgMembers } from '@/core/db';
import { type WriteOutcome, responseCodec } from '@/core/db/idempotent-write';
import type { DbTransaction } from '@/core/db/transaction';
import { HTTP } from '@/core/http/api-errors';
import { formatEuroCents } from '@/core/utils/money';
import { currencySchema } from '@/core/validators/currency';
import { hasCapturingExpensePayment } from '@/features/expenses/expense-payments';
import { loadSettlementSnapshot, pairIsInWg } from '@/features/expenses/settle-debt';
import { selectSettlementScope } from '@/features/expenses/settlement-scope';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

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

type ManualPaymentOutcome =
	| { kind: 'member_deactivated' }
	| { kind: 'member_not_in_wg' }
	| { kind: 'blocked' }
	| { kind: 'changed' }
	| { kind: 'recorded'; paymentId: string; amountCents: number };

/** Rejections are answered by the route and not stored, so the same key can run again. */
function rejected(
	kind: Exclude<ManualPaymentOutcome['kind'], 'recorded'>,
): WriteOutcome<unknown, ManualPaymentOutcome> {
	const status =
		kind === 'member_deactivated'
			? HTTP.UNAUTHORIZED
			: kind === 'member_not_in_wg'
				? HTTP.BAD_REQUEST
				: HTTP.CONFLICT;
	return { status, body: null, context: { kind } };
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
	callerName = 'Ein Mitglied',
): Promise<WriteOutcome<unknown, ManualPaymentOutcome>> {
	const [activeCaller] = await tx
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(eq(wgMembers.id, callerId), eq(wgMembers.wgId, wgId), isNull(wgMembers.deactivatedAt)),
		)
		.limit(1)
		.for('update');
	if (!activeCaller) return rejected('member_deactivated');

	const snapshot = await loadSettlementSnapshot(tx, wgId);
	if (!pairIsInWg(snapshot, input.fromMemberId, input.toMemberId)) {
		return rejected('member_not_in_wg');
	}
	// Both sides must still live in the WG; a moved-out member's debt is settled by other means.
	const activePair = await tx
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				inArray(wgMembers.id, [input.fromMemberId, input.toMemberId]),
				isNull(wgMembers.deactivatedAt),
			),
		);
	if (activePair.length !== 2) return rejected('member_not_in_wg');
	if (await hasCapturingExpensePayment(tx, wgId)) return rejected('blocked');

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

	const now = new Date();
	const [payment] = await tx
		.insert(expensePayments)
		.values({
			wgId,
			fromMemberId: input.fromMemberId,
			toMemberId: input.toMemberId,
			amountCents: preview.netCents,
			currency: preview.currency,
			provider: 'manual',
			providerOrderId: `manual:${crypto.randomUUID()}`,
			payeeMerchantId: 'manual',
			status: 'completed',
			expiresAt: now,
			completedAt: now,
		})
		.returning({ id: expensePayments.id });
	if (!payment) throw new Error('manual_payment_insert_failed');
	// Written with the payment, so a replayed request never finds a payment without its author.
	await tx.insert(auditEvents).values({
		wgId,
		memberId: callerId,
		eventType: 'expense.debt.settled.manual',
		entityType: 'expense_payment',
		entityId: payment.id,
		summary: `${callerName} hat eine Barzahlung über ${formatEuroCents(preview.netCents, preview.currency)} eingetragen.`,
		metadataJson: JSON.stringify({
			fromMemberId: input.fromMemberId,
			toMemberId: input.toMemberId,
			amountCents: preview.netCents,
			currency: preview.currency,
		}),
	});
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
