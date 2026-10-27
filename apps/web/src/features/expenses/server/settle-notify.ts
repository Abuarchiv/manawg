import 'server-only';
import { recordAuditEvent } from '@/core/audit';
import { logApiError } from '@/core/infra/observability';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { formatEuroCents } from '@/core/utils/money';

/** Tells the other party of a settlement (manual or PayPal) that it was recorded. */
export function notifySettlement(input: {
	wg: { id: string; name: string; shareCode: string };
	actor: { memberId: string; name: string };
	otherMemberId: string;
	amountCents: number;
	currency: string;
	/** `paid`: the actor paid the other party; `received`: the actor confirmed receiving money. */
	direction: 'paid' | 'received';
}) {
	return dispatchNotificationSafely({
		wg: input.wg,
		event: 'expense.debt_settled',
		payload: {
			actorName: input.actor.name,
			amountCents: input.amountCents,
			currency: input.currency,
			direction: input.direction,
		},
		targetMemberIds: [input.otherMemberId],
		excludeMemberId: input.actor.memberId,
	});
}

interface PayPalPaymentSummary {
	id: string;
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
	providerOrderId: string | null;
}

/** Audit entry for a captured PayPal payment; throws when the write fails, callers log it. */
export async function recordPayPalSettlementAudit(
	wgId: string,
	payer: { memberId: string; name: string },
	payment: PayPalPaymentSummary,
): Promise<void> {
	await recordAuditEvent({
		wgId,
		memberId: payer.memberId,
		eventType: 'expense.debt.paid.paypal',
		entityType: 'expense_payment',
		entityId: payment.id,
		summary: `${payer.name} hat ${formatEuroCents(payment.amountCents, payment.currency)} per PayPal beglichen.`,
		metadata: {
			fromMemberId: payment.fromMemberId,
			toMemberId: payment.toMemberId,
			amountCents: payment.amountCents,
			providerOrderId: payment.providerOrderId,
		},
	});
}

/** Audit entry plus notification for a captured PayPal payment; audit failures are logged, not thrown. */
export async function announcePayPalSettlement(
	wg: { id: string; name: string; shareCode: string },
	actor: { memberId: string; name: string },
	payment: PayPalPaymentSummary,
): Promise<void> {
	try {
		await recordPayPalSettlementAudit(wg.id, actor, payment);
	} catch (auditError) {
		logApiError('[paypal capture] audit failed', auditError);
	}
	await notifySettlement({
		wg,
		actor,
		otherMemberId: payment.toMemberId,
		amountCents: payment.amountCents,
		currency: payment.currency,
		direction: 'paid',
	});
}
