import { recordAuditEvent } from '@/core/audit';
import { db, expensePayments, wgMembers } from '@/core/db';
import { lockActiveAccountMember } from '@/core/db/account-deletion';
import {
	badRequest,
	conflict,
	forbidden,
	requireVerifiedMember,
	serverError,
	tooMany,
} from '@/core/errors';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { logApiError } from '@/core/infra/observability';
import {
	type PayPalOrderResponse,
	capturePayPalOrder,
	getPayPalOrder,
	isPayPalConfigured,
} from '@/core/infra/paypal';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { computeNetBalances, simplifyDebts } from '@/features/expenses/debt-reduction';
import {
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/expense-payments';
import { loadOpenExpenses } from '@/features/expenses/open-expenses';
import { isPayPalCaptureDebtChanged } from '@/features/expenses/paypal-settlement';
import { and, eq, gt } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const captureSchema = z.object({ orderId: z.string().trim().min(1).max(100) });

export const POST = withWgRoute('paypal capture POST', async (req, { code }) => {
	if (!isPayPalConfigured()) return conflict('paypal_not_configured');

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return badRequest('invalid_json');
	}
	const parsed = captureSchema.safeParse(body);
	if (!parsed.success) return badRequest('order_id_invalid');

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const verified = requireVerifiedMember(auth.member);
	if (verified) return verified;
	const limited = await checkRateLimit(
		wgWriteLimiter,
		`paypal-capture:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	try {
		const [payment] = await db
			.select()
			.from(expensePayments)
			.where(
				and(
					eq(expensePayments.wgId, auth.wg.id),
					eq(expensePayments.providerOrderId, parsed.data.orderId),
				),
			)
			.limit(1);
		if (!payment) return conflict('paypal_order_not_found');
		if (payment.fromMemberId !== auth.member.memberId) {
			return forbidden('not_party_to_debt', 'not_party_to_debt');
		}
		if (payment.status === 'completed') {
			return NextResponse.json({
				status: 'COMPLETED',
				amountCents: payment.amountCents,
				currency: payment.currency,
			});
		}

		const captureState = await withExpensePaymentLock(auth.wg.id, async (tx) => {
			const actor = await lockActiveAccountMember(
				tx,
				auth.wg.id,
				auth.member.memberId,
				auth.authUserId,
			);
			if (!actor) return { kind: 'member_inactive' as const };
			const [current] = await tx
				.select()
				.from(expensePayments)
				.where(and(eq(expensePayments.id, payment.id), eq(expensePayments.wgId, auth.wg.id)))
				.limit(1);
			if (!current) return { kind: 'missing' as const };
			if (current.status === 'completed') return { kind: 'completed' as const, payment: current };
			if (current.status === 'capturing') return { kind: 'capture' as const, payment: current };
			if (current.status !== 'created') return { kind: 'unavailable' as const };

			const now = new Date();
			if (current.expiresAt <= now) {
				await tx
					.update(expensePayments)
					.set({ status: 'failed' })
					.where(and(eq(expensePayments.id, current.id), eq(expensePayments.status, 'created')));
				return { kind: 'expired' as const };
			}

			const [capturing] = await tx
				.update(expensePayments)
				.set({ status: 'capturing' })
				.where(
					and(
						eq(expensePayments.id, current.id),
						eq(expensePayments.status, 'created'),
						gt(expensePayments.expiresAt, now),
					),
				)
				.returning();
			return capturing
				? { kind: 'capture' as const, payment: capturing }
				: { kind: 'unavailable' as const };
		});
		if (captureState.kind === 'member_inactive') return forbidden('member_deactivated');
		if (captureState.kind === 'completed') {
			return NextResponse.json({
				status: 'COMPLETED',
				amountCents: captureState.payment.amountCents,
				currency: captureState.payment.currency,
			});
		}
		if (captureState.kind === 'expired') return conflict('paypal_order_expired');
		if (captureState.kind === 'missing') return conflict('paypal_order_not_found');
		if (captureState.kind === 'unavailable') return conflict('paypal_order_unavailable');
		const capturePayment = captureState.payment;

		const debtChanged = await withExpensePaymentLock(auth.wg.id, async (tx) => {
			const [members, expenses, payments] = await Promise.all([
				tx
					.select({ id: wgMembers.id, name: wgMembers.name, color: wgMembers.color })
					.from(wgMembers)
					.where(eq(wgMembers.wgId, auth.wg.id)),
				loadOpenExpenses(auth.wg.id, tx),
				loadCompletedExpensePayments(auth.wg.id, tx),
			]);
			const debt = simplifyDebts(computeNetBalances(expenses, members, payments)).find(
				(item) =>
					item.fromId === capturePayment.fromMemberId &&
					item.toId === capturePayment.toMemberId &&
					(item.currency ?? 'EUR') === capturePayment.currency,
			);
			if (!isPayPalCaptureDebtChanged(debt?.cents, capturePayment.amountCents)) return false;
			await tx
				.update(expensePayments)
				.set({ status: 'failed' })
				.where(
					and(eq(expensePayments.id, capturePayment.id), eq(expensePayments.status, 'capturing')),
				);
			return true;
		});
		if (debtChanged) {
			return conflict('debt_changed');
		}

		let order: PayPalOrderResponse | undefined;
		try {
			order = await capturePayPalOrder(
				capturePayment.providerOrderId,
				capturePayment.payeeMerchantId,
			);
		} catch (captureError) {
			// A network/5xx response does not tell us whether PayPal captured the
			// order. Re-read the order before returning so an approved capture can
			// still be committed locally without creating a second payment.
			try {
				order = await getPayPalOrder(
					capturePayment.providerOrderId,
					capturePayment.payeeMerchantId,
				);
			} catch (statusError) {
				logApiError('[paypal capture] status recovery failed', captureError, statusError);
				return conflict('paypal_capture_pending');
			}
		}
		const capture = order.purchase_units
			?.flatMap((unit) => unit.payments?.captures ?? [])
			.find((item) => item.status === 'COMPLETED');
		const capturedCents = capture?.amount?.value
			? Math.round(Number(capture.amount.value) * 100)
			: 0;
		if (order.status !== 'COMPLETED' || !capture) {
			await withExpensePaymentLock(auth.wg.id, (tx) =>
				tx
					.update(expensePayments)
					.set({ status: 'failed' })
					.where(
						and(eq(expensePayments.id, capturePayment.id), eq(expensePayments.status, 'capturing')),
					),
			);
			return conflict('paypal_payment_not_completed');
		}
		if (
			capturedCents !== capturePayment.amountCents ||
			capture.amount?.currency_code !== capturePayment.currency
		) {
			return conflict('paypal_payment_not_completed');
		}

		const completion = await withExpensePaymentLock(auth.wg.id, async (tx) => {
			const [completed] = await tx
				.update(expensePayments)
				.set({ status: 'completed', completedAt: new Date() })
				.where(
					and(eq(expensePayments.id, capturePayment.id), eq(expensePayments.status, 'capturing')),
				)
				.returning({ id: expensePayments.id });
			if (completed) return 'completed' as const;
			const [alreadyCompleted] = await tx
				.select({ status: expensePayments.status })
				.from(expensePayments)
				.where(eq(expensePayments.id, capturePayment.id))
				.limit(1);
			return alreadyCompleted?.status === 'completed' ? 'already_completed' : 'failed';
		});
		if (completion === 'failed') return serverError('paypal_settlement_failed');
		if (completion === 'already_completed') {
			return NextResponse.json({
				status: 'COMPLETED',
				amountCents: capturePayment.amountCents,
				currency: capturePayment.currency,
			});
		}
		try {
			await recordAuditEvent({
				wgId: auth.wg.id,
				memberId: auth.member.memberId,
				eventType: 'expense.debt.paid.paypal',
				entityType: 'expense_payment',
				entityId: capturePayment.id,
				summary: `${auth.member.name} hat ${capturePayment.amountCents / 100} ${capturePayment.currency} per PayPal beglichen.`,
				metadata: {
					fromMemberId: capturePayment.fromMemberId,
					toMemberId: capturePayment.toMemberId,
					amountCents: capturePayment.amountCents,
					providerOrderId: capturePayment.providerOrderId,
				},
			});
		} catch (auditError) {
			logApiError('[paypal capture] audit failed', auditError);
		}

		return NextResponse.json({
			status: 'COMPLETED',
			amountCents: capturePayment.amountCents,
			currency: capturePayment.currency,
		});
	} catch (err) {
		logApiError('[paypal capture]', err);
		return serverError('paypal_capture_failed');
	}
});
