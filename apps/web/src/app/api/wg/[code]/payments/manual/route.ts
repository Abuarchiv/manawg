import { withIdempotentWrite } from '@/core/db/idempotent-write';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	conflict,
	forbidden,
	rateLimitResponse,
	unauthorized,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { withExpensePaymentLock } from '@/features/expenses/server/expense-payments';
import {
	manualPaymentCodec,
	manualPaymentSchema,
	recordCashPayment,
} from '@/features/expenses/server/manual-payment';
import { notifySettlement } from '@/features/expenses/server/settle-notify';
import { NextResponse } from 'next/server';

/**
 * Enter a cash payment that settles the whole current net debt between two members. Either member
 * of the pair may enter it, as with settling single shares; nothing is transferred by ManaWG.
 */
export const POST = withWgRoute('manual payment POST', async (req, { code }) => {
	const parsed = await parseBody(req, manualPaymentSchema, {
		fieldErrors: {
			fromMemberId: 'member_ids_invalid',
			toMemberId: 'member_ids_invalid',
			currency: 'currency_invalid',
			expectedNetCents: 'amount_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const input = parsed.data;
	if (input.fromMemberId === input.toMemberId) return badRequest('same_member');

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const caller = auth.member.memberId;
	if (caller !== input.fromMemberId && caller !== input.toMemberId) {
		return forbidden('not_party_to_debt', 'not_party_to_debt');
	}

	const result = await withIdempotentWrite(
		{
			scope: `manual-payment:${auth.wg.id}:${caller}`,
			key: readIdempotencyKey(req),
			codec: manualPaymentCodec,
			inTransaction: (work) => withExpensePaymentLock(auth.wg.id, work),
			prepare: async () => {
				const limited = rateLimitResponse(
					await checkRateLimit(wgWriteLimiter, `manual-payment:${auth.wg.id}:${caller}`),
				);
				return limited ? { stop: limited } : { input: undefined };
			},
		},
		(tx) => recordCashPayment(tx, auth.wg.id, caller, input, auth.member.name),
	);
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'replayed') {
		return NextResponse.json(result.body, {
			status: result.status,
			headers: { 'Cache-Control': 'no-store' },
		});
	}
	const outcome = result.context;
	if (!outcome || outcome.kind === 'member_deactivated') {
		return unauthorized('member_deactivated', 'member_deactivated');
	}
	if (outcome.kind === 'member_not_in_wg') return badRequest('member_not_in_wg');
	if (outcome.kind === 'changed') return conflict('settlement_changed');

	const paid = caller === input.fromMemberId;
	await notifySettlement({
		wg: auth.wg,
		actor: auth.member,
		otherMemberId: paid ? input.toMemberId : input.fromMemberId,
		amountCents: outcome.amountCents,
		currency: input.currency,
		direction: paid ? 'paid' : 'received',
	});

	return NextResponse.json(result.body, {
		status: result.status,
		headers: { 'Cache-Control': 'no-store' },
	});
});
