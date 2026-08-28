import { recordAuditEvent } from '@/core/audit';
import { db, expenseSplits, expenses, wgs } from '@/core/db';
import { badRequest, forbidden, notFound, tooMany } from '@/core/errors';
import { UUID_PATTERN, requireMember } from '@/core/guards/api-auth';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { and, eq } from 'drizzle-orm';
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
		const expenseRow = await db
			.select({
				id: expenses.id,
				wgId: expenses.wgId,
				description: expenses.description,
				paidByMemberId: expenses.paidByMemberId,
			})
			.from(expenses)
			.innerJoin(wgs, eq(wgs.id, expenses.wgId))
			.where(and(eq(expenses.id, id), eq(wgs.shareCode, code)))
			.limit(1);
		if (expenseRow.length === 0) return notFound('expense_not_found');

		const expense = expenseRow[0];
		if (!expense) return notFound('expense_not_found');
		const auth = await requireMember(req, expense.wgId);
		if (!auth.ok) return auth.response;
		// Money mutation: a bare x-manawg-member-id is spoofable (harvested from
		// GET /api/wg/[code]/members), so require a verified HMAC token before
		// trusting the caller's claimed identity for the debtor/payer check.
		if (!auth.member.verified) return forbidden('member_not_verified', 'member_not_verified');

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

		const [updated] = await db
			.update(expenseSplits)
			.set({ settledAt: settled ? new Date() : null })
			.where(and(eq(expenseSplits.id, splitId), eq(expenseSplits.expenseId, id)))
			.returning();
		if (!updated) return notFound('split_not_found');
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
