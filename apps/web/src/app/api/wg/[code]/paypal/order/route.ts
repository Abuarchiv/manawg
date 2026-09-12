import { randomUUID } from 'node:crypto';
import { expensePayments, wgMembers } from '@/core/db';
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
import { createPayPalOrder, isPayPalConfigured } from '@/core/infra/paypal';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { computeNetBalances, simplifyDebts } from '@/features/expenses/debt-reduction';
import { computeBalances } from '@/features/expenses/debts';
import {
	PAYPAL_ORDER_TTL_MS,
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/expense-payments';
import { loadOpenExpenses } from '@/features/expenses/open-expenses';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const orderSchema = z.object({
	fromMemberId: z.string().uuid(),
	toMemberId: z.string().uuid(),
});

export const POST = withWgRoute('paypal order POST', async (req, { code }) => {
	if (!isPayPalConfigured()) return conflict('paypal_not_configured');

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return badRequest('invalid_json');
	}
	const parsed = orderSchema.safeParse(body);
	if (!parsed.success || parsed.data.fromMemberId === parsed.data.toMemberId) {
		return badRequest('member_ids_invalid');
	}

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const verified = requireVerifiedMember(auth.member);
	if (verified) return verified;
	if (auth.member.memberId !== parsed.data.fromMemberId) {
		return forbidden('not_party_to_debt', 'not_party_to_debt');
	}
	const limited = await checkRateLimit(
		wgWriteLimiter,
		`paypal-order:${auth.wg.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	try {
		const reservation = await withExpensePaymentLock(auth.wg.id, async (tx) => {
			const [members, expenses, payments] = await Promise.all([
				tx
					.select({
						id: wgMembers.id,
						name: wgMembers.name,
						color: wgMembers.color,
						paypalMerchantId: wgMembers.paypalMerchantId,
					})
					.from(wgMembers)
					.where(eq(wgMembers.wgId, auth.wg.id)),
				loadOpenExpenses(auth.wg.id, tx),
				loadCompletedExpensePayments(auth.wg.id, tx),
			]);
			const memberById = new Map(members.map((member) => [member.id, member]));
			const payee = memberById.get(parsed.data.toMemberId);
			if (!payee) return { kind: 'response' as const, response: badRequest('member_not_in_wg') };
			if (!payee.paypalMerchantId) {
				return { kind: 'response' as const, response: conflict('paypal_recipient_missing') };
			}
			if (
				expenses.some(
					(expense) =>
						expense.currency !== undefined &&
						expense.currency !== 'EUR' &&
						expense.splits.some((split) => split.settledAt === null && split.amountCents > 0),
				)
			) {
				return { kind: 'response' as const, response: conflict('paypal_currency_unsupported') };
			}

			const debt = simplifyDebts(computeNetBalances(expenses, members, payments)).find(
				(item) => item.fromId === parsed.data.fromMemberId && item.toId === parsed.data.toMemberId,
			);
			if (!debt || debt.cents <= 0) {
				return { kind: 'response' as const, response: conflict('no_open_debt') };
			}
			const directDebt = computeBalances(expenses, payments).find(
				(item) =>
					item.debtorId === parsed.data.fromMemberId && item.creditorId === parsed.data.toMemberId,
			);
			if (!directDebt || directDebt.amountCents < debt.cents) {
				return { kind: 'response' as const, response: conflict('paypal_direct_debt_required') };
			}

			const now = new Date();
			const existing = await tx
				.select({
					id: expensePayments.id,
					status: expensePayments.status,
					orderId: expensePayments.providerOrderId,
					amountCents: expensePayments.amountCents,
					expiresAt: expensePayments.expiresAt,
				})
				.from(expensePayments)
				.where(
					and(
						eq(expensePayments.wgId, auth.wg.id),
						eq(expensePayments.fromMemberId, parsed.data.fromMemberId),
						eq(expensePayments.toMemberId, parsed.data.toMemberId),
						inArray(expensePayments.status, ['created', 'capturing']),
					),
				)
				.limit(1);
			const current = existing[0];
			if (current?.status === 'capturing') {
				return { kind: 'response' as const, response: conflict('paypal_order_in_progress') };
			}
			if (current && current.expiresAt > now) {
				if (current.orderId.startsWith('pending:')) {
					return { kind: 'response' as const, response: conflict('paypal_order_creating') };
				}
				return {
					kind: 'response' as const,
					response: NextResponse.json({
						orderId: current.orderId,
						amountCents: current.amountCents,
					}),
				};
			}
			if (current) {
				const expired = await tx
					.update(expensePayments)
					.set({ status: 'failed' })
					.where(
						and(
							eq(expensePayments.id, current.id),
							eq(expensePayments.status, 'created'),
							lte(expensePayments.expiresAt, now),
						),
					)
					.returning({ id: expensePayments.id });
				if (expired.length === 0) {
					return { kind: 'response' as const, response: conflict('paypal_order_in_progress') };
				}
			}

			const [payment] = await tx
				.insert(expensePayments)
				.values({
					wgId: auth.wg.id,
					fromMemberId: parsed.data.fromMemberId,
					toMemberId: parsed.data.toMemberId,
					amountCents: debt.cents,
					currency: 'EUR',
					providerOrderId: `pending:${randomUUID()}`,
					payeeMerchantId: payee.paypalMerchantId,
					expiresAt: new Date(now.getTime() + PAYPAL_ORDER_TTL_MS),
				})
				.onConflictDoNothing({
					target: [expensePayments.wgId, expensePayments.fromMemberId, expensePayments.toMemberId],
					where: sql`${expensePayments.status} in ('created', 'capturing')`,
				})
				.returning({ id: expensePayments.id });
			if (!payment) {
				return { kind: 'response' as const, response: conflict('paypal_order_in_progress') };
			}

			return {
				kind: 'created' as const,
				paymentId: payment.id,
				amountCents: debt.cents,
				payeeMerchantId: payee.paypalMerchantId,
				payeeName: payee.name,
				fromName: memberById.get(parsed.data.fromMemberId)?.name ?? 'Mitglied',
			};
		});
		if (reservation.kind === 'response') return reservation.response;

		try {
			const order = await createPayPalOrder({
				amountCents: reservation.amountCents,
				currency: 'EUR',
				description: `ManaWG-Ausgleich: ${reservation.fromName} an ${reservation.payeeName}`,
				payeeMerchantId: reservation.payeeMerchantId,
				customId: `manawg:${auth.wg.id}:${reservation.paymentId}`,
			});
			if (!order.id) throw new Error('paypal_order_id_missing');
			await withExpensePaymentLock(auth.wg.id, (tx) =>
				tx
					.update(expensePayments)
					.set({ providerOrderId: order.id })
					.where(eq(expensePayments.id, reservation.paymentId)),
			);
			return NextResponse.json({ orderId: order.id, amountCents: reservation.amountCents });
		} catch (err) {
			await withExpensePaymentLock(auth.wg.id, (tx) =>
				tx
					.update(expensePayments)
					.set({ status: 'failed' })
					.where(eq(expensePayments.id, reservation.paymentId)),
			);
			throw err;
		}
	} catch (err) {
		console.error('[paypal order]', err);
		return serverError('paypal_order_failed');
	}
});
