import { recordAuditEvent } from '@/core/audit';
import { db, expenseSplits, expenses } from '@/core/db';
import {
	badRequest,
	conflict,
	forbidden,
	notFound,
	requireVerifiedMember,
	tooMany,
} from '@/core/errors';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import {
	hasActiveExpensePayment,
	withExpensePaymentLock,
} from '@/features/expenses/expense-payments';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const POST = withWgRoute<{ id: string; splitId: string }>(
	'split settle POST',
	async (req, { code, id, splitId }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		if (!UUID_PATTERN.test(splitId)) return badRequest('id_invalid');

		let body: { settled?: unknown };
		try {
			body = (await req.json()) as { settled?: unknown };
		} catch {
			return badRequest('invalid_json');
		}
		if (body.settled !== undefined && typeof body.settled !== 'boolean') {
			return badRequest('settled_invalid');
		}
		const settled = body.settled ?? true;
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const expenseRow = await db
			.select({
				id: expenses.id,
				wgId: expenses.wgId,
				description: expenses.description,
				paidByMemberId: expenses.paidByMemberId,
			})
			.from(expenses)
			.where(and(eq(expenses.id, id), eq(expenses.wgId, wgId)))
			.limit(1);
		const expense = expenseRow[0];
		if (!expense) return notFound('expense_not_found');
		// Money mutation: a bare x-manawg-member-id is spoofable (harvested from
		// GET /api/wg/[code]/members), so require a verified HMAC token before
		// trusting the caller's claimed identity for the debtor/payer check.
		const unverified = requireVerifiedMember(auth.member);
		if (unverified) return unverified;

		const splitRow = await db
			.select({
				id: expenseSplits.id,
				debtorMemberId: expenseSplits.debtorMemberId,
				expenseId: expenseSplits.expenseId,
				settledAt: expenseSplits.settledAt,
			})
			.from(expenseSplits)
			.where(and(eq(expenseSplits.id, splitId), eq(expenseSplits.expenseId, id)))
			.limit(1);
		const split = splitRow[0];
		if (!split) return notFound('split_not_found');

		// Only the debtor (paying off their share) or the payer (marking that
		// they received the money) may settle. Other WG members cannot flip
		// someone else's debt state.
		const isDebtor = split.debtorMemberId === auth.member.memberId;
		const isPayer = expense.paidByMemberId === auth.member.memberId;
		if (!isDebtor && !isPayer) return forbidden('not_split_party', 'not_split_party');
		if ((settled && split.settledAt !== null) || (!settled && split.settledAt === null)) {
			return NextResponse.json({ split });
		}
		const limited = await checkRateLimit(
			wgWriteLimiter,
			`split-settle:${expense.wgId}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		// Guard the write on the state we just read: settling requires the split
		// to currently be unsettled, un-settling requires it to currently be
		// settled. Without this, two concurrent opposite toggles race to
		// last-write-wins — whichever request's UPDATE commits last silently
		// overwrites the other's result. With the guard, a stale toggle (the
		// state already changed since our read above) matches zero rows and
		// becomes a no-op instead of clobbering the newer state.
		const change = await withExpensePaymentLock(expense.wgId, async (tx) => {
			if (await hasActiveExpensePayment(tx, expense.wgId)) return { blocked: true as const };
			const [updated] = await tx
				.update(expenseSplits)
				.set({ settledAt: settled ? new Date() : null })
				.where(
					and(
						eq(expenseSplits.id, splitId),
						eq(expenseSplits.expenseId, id),
						settled ? isNull(expenseSplits.settledAt) : isNotNull(expenseSplits.settledAt),
					),
				)
				.returning();
			return { blocked: false as const, updated };
		});
		if (change.blocked) return conflict('paypal_payment_pending');
		const updated = change.updated;
		if (!updated) return NextResponse.json({ split });
		await recordAuditEvent({
			wgId: expense.wgId,
			memberId: auth.member.memberId,
			eventType: settled ? 'expense.split.settled' : 'expense.split.reopened',
			entityType: 'expense_split',
			entityId: splitId,
			summary: settled
				? `${auth.member.name} hat einen Anteil für ${expense.description} beglichen.`
				: `${auth.member.name} hat einen Anteil für ${expense.description} wieder geöffnet.`,
			metadata: {
				expenseId: expense.id,
				description: expense.description,
				debtorMemberId: split.debtorMemberId,
				paidByMemberId: expense.paidByMemberId,
			},
		});

		return NextResponse.json({ split: updated });
	},
);
