import { withIdempotentWrite } from '@/core/db/idempotent-write';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	rateLimitResponse,
	unauthorized,
} from '@/core/http/api-errors';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { afterResponse } from '@/core/infra/after-response';
import { dispatchNotificationSafely } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { withExpensePaymentLock } from '@/features/expenses/server/expense-payments';
import { voidCashPayment, voidCashPaymentCodec } from '@/features/expenses/server/manual-payment';
import { NextResponse } from 'next/server';

/**
 * Void a cash payment. Either member of the pair may do it, as with entering it; correcting a
 * payment means voiding it and entering it again.
 */
export const DELETE = withWgRoute<{ id: string }>(
	'manual payment DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const caller = auth.member.memberId;

		const result = await withIdempotentWrite(
			{
				scope: `manual-payment-void:${auth.wg.id}:${caller}`,
				key: readIdempotencyKey(req),
				codec: voidCashPaymentCodec,
				inTransaction: (work) => withExpensePaymentLock(auth.wg.id, work),
				prepare: async () => {
					const limited = rateLimitResponse(
						await checkRateLimit(wgWriteLimiter, `manual-payment:${auth.wg.id}:${caller}`),
					);
					return limited ? { stop: limited } : { input: undefined };
				},
			},
			(tx) => voidCashPayment(tx, auth.wg.id, caller, id, auth.member.name),
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'written') {
			const kind = result.context?.kind;
			if (!kind || kind === 'member_deactivated') {
				return unauthorized('member_deactivated', 'member_deactivated');
			}
			if (kind === 'not_found') return notFound('payment_not_found');
			if (kind === 'not_party') return forbidden('not_party_to_debt', 'not_party_to_debt');
			if (kind === 'already_voided') return conflict('payment_voided');
			const voided = result.context;
			if (voided?.kind === 'voided') {
				afterResponse(() =>
					dispatchNotificationSafely({
						wg: auth.wg,
						event: 'expense.payment_voided',
						payload: {
							actorName: auth.member.name,
							amountCents: voided.amountCents,
							currency: voided.currency,
						},
						targetMemberIds: [voided.otherMemberId],
						excludeMemberId: caller,
					}),
				);
			}
		}
		return NextResponse.json(result.body, {
			status: result.status,
			headers: { 'Cache-Control': 'no-store' },
		});
	},
);
