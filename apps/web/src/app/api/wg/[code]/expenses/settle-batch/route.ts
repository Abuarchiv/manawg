import { UUID_PATTERN } from '@/lib/api-auth';
import { badRequest, forbidden, tooMany } from '@/lib/api-error';
import { db, expenseSplits, expenses, wgMembers } from '@/lib/db';
import { claimIdempotencySlot, readIdempotencyKey } from '@/lib/idempotency';
import { checkRateLimit, wgWriteLimiter } from '@/lib/rate-limit';
import { recordAuditEvent } from '@/lib/wg/audit';
import { computeNetBalances, simplifyDebts } from '@/lib/wg/debt-reduction';
import { groupSplitsByExpense } from '@/lib/wg/open-expenses';
import { requireWgMember } from '@/lib/wg/require-wg-member';
import { withWgRoute } from '@/lib/wg/with-wg-route';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const POST = withWgRoute('settle-batch POST', async (req, { code }) => {
	let body: { fromMemberId?: unknown; toMemberId?: unknown };
	try {
		body = (await req.json()) as { fromMemberId?: unknown; toMemberId?: unknown };
	} catch {
		return badRequest('invalid_json');
	}

	const fromMemberId =
		typeof body.fromMemberId === 'string' && UUID_PATTERN.test(body.fromMemberId)
			? body.fromMemberId
			: null;
	const toMemberId =
		typeof body.toMemberId === 'string' && UUID_PATTERN.test(body.toMemberId)
			? body.toMemberId
			: null;

	if (!fromMemberId || !toMemberId) return badRequest('member_ids_invalid');
	if (fromMemberId === toMemberId) return badRequest('same_member');
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgRow = auth.wg;

	const members = await db
		.select({ id: wgMembers.id, name: wgMembers.name, color: wgMembers.color })
		.from(wgMembers)
		.where(eq(wgMembers.wgId, wgRow.id));
	const memberIds = new Set(members.map((member) => member.id));
	if (!memberIds.has(fromMemberId) || !memberIds.has(toMemberId)) {
		return badRequest('member_not_in_wg');
	}

	// Money mutation: a bare x-manawg-member-id is spoofable, so require a
	// verified HMAC token before trusting the caller's claimed identity.
	if (!auth.member.verified) return forbidden('member_not_verified', 'member_not_verified');

	// Only the debtor (from) or the creditor (to) may batch-settle
	if (auth.member.memberId !== fromMemberId && auth.member.memberId !== toMemberId) {
		return forbidden('not_party_to_debt', 'not_party_to_debt');
	}

	const limited = await checkRateLimit(
		wgWriteLimiter,
		`settle-batch:${wgRow.id}:${auth.member.memberId}`,
	);
	if (!limited.success) return tooMany();

	const expenseRows = await db
		.select({
			id: expenses.id,
			paidByMemberId: expenses.paidByMemberId,
			occurredAt: expenses.occurredAt,
		})
		.from(expenses)
		.where(eq(expenses.wgId, wgRow.id));

	if (expenseRows.length === 0) {
		return NextResponse.json({
			settled: 0,
			settledIds: [],
			settledCents: 0,
			remainingCents: 0,
			creditor: toMemberId,
			debtor: fromMemberId,
		});
	}

	const expenseIds = expenseRows.map((e) => e.id);
	const splitRows = await db
		.select({
			id: expenseSplits.id,
			expenseId: expenseSplits.expenseId,
			debtorMemberId: expenseSplits.debtorMemberId,
			amountCents: expenseSplits.amountCents,
			settledAt: expenseSplits.settledAt,
		})
		.from(expenseSplits)
		.where(inArray(expenseSplits.expenseId, expenseIds));

	const splitsByExpense = groupSplitsByExpense(splitRows);

	const netDebt = simplifyDebts(
		computeNetBalances(
			expenseRows.map((expense) => ({
				paidByMemberId: expense.paidByMemberId,
				splits: splitsByExpense.get(expense.id) ?? [],
			})),
			members,
		),
	).find((debt) => debt.fromId === fromMemberId && debt.toId === toMemberId);

	if (!netDebt || netDebt.cents <= 0) {
		return NextResponse.json({
			settled: 0,
			settledIds: [],
			settledCents: 0,
			remainingCents: 0,
			creditor: toMemberId,
			debtor: fromMemberId,
		});
	}

	const paidByByExpense = new Map(
		expenseRows.map((expense) => [expense.id, expense.paidByMemberId]),
	);
	// Settle deterministically, oldest expense first, so repeated runs (and
	// concurrent requests) always pick the same splits instead of depending
	// on whatever order Postgres happens to return rows in.
	const occurredAtByExpense = new Map(
		expenseRows.map((expense) => [expense.id, new Date(expense.occurredAt).getTime()]),
	);
	const orderedSplitRows = [...splitRows].sort((a, b) => {
		const diff =
			(occurredAtByExpense.get(a.expenseId) ?? 0) - (occurredAtByExpense.get(b.expenseId) ?? 0);
		return diff !== 0 ? diff : a.id.localeCompare(b.id);
	});
	const splitIdsToSettle: string[] = [];
	let remainingCents = netDebt.cents;
	for (const split of orderedSplitRows) {
		if (remainingCents <= 0) break;
		if (split.debtorMemberId !== fromMemberId) continue;
		if (paidByByExpense.get(split.expenseId) !== toMemberId) continue;
		if (split.settledAt !== null) continue;
		if (split.amountCents <= 0 || split.amountCents > remainingCents) continue;

		splitIdsToSettle.push(split.id);
		remainingCents -= split.amountCents;
	}

	if (splitIdsToSettle.length === 0) {
		// The simplified net debt exists, but it flows entirely through other
		// members — there is no direct split to mark settled. Report that
		// honestly instead of pretending the pair is already even.
		return NextResponse.json({
			settled: 0,
			settledIds: [],
			settledCents: 0,
			remainingCents: netDebt.cents,
			reason: 'no_direct_splits',
			creditor: toMemberId,
			debtor: fromMemberId,
		});
	}

	// Settle only direct splits that fit into the simplified net debt.
	const settled = await db
		.update(expenseSplits)
		.set({ settledAt: new Date() })
		.where(
			and(
				eq(expenseSplits.debtorMemberId, fromMemberId),
				isNull(expenseSplits.settledAt),
				inArray(expenseSplits.id, splitIdsToSettle),
			),
		)
		.returning({ id: expenseSplits.id });
	const expectedSettledIds = new Set(splitIdsToSettle);
	const settledIds = settled.map((item) => item.id).filter((id) => expectedSettledIds.has(id));
	const centsBySplitId = new Map(splitRows.map((split) => [split.id, split.amountCents]));
	const settledCents = settledIds.reduce((sum, id) => sum + (centsBySplitId.get(id) ?? 0), 0);
	if (settledIds.length > 0) {
		// Without a client key, derive one deterministically from the settled
		// set — two racing identical batches then share a claim slot, so
		// only the first writes the audit event.
		const idemKey =
			readIdempotencyKey(req) ??
			`derived:settle:${fromMemberId}:${toMemberId}:${[...settledIds].sort().join(',')}`;
		// Scope the claim by wg+member, not just the raw client-generated key,
		// so a key collision across different callers can never suppress an
		// audit event that should have been recorded.
		const shouldAudit = await claimIdempotencySlot(
			`settle-batch:${wgRow.id}:${auth.member.memberId}`,
			idemKey,
		);
		if (shouldAudit) {
			await recordAuditEvent({
				wgId: wgRow.id,
				memberId: auth.member.memberId,
				eventType: 'expense.debt.settled',
				entityType: 'expense_debt',
				entityId: `${fromMemberId}:${toMemberId}`,
				summary: `${auth.member.name} hat ${settledIds.length} offene Anteil${settledIds.length === 1 ? '' : 'e'} beglichen.`,
				metadata: { fromMemberId, toMemberId, splitIds: settledIds },
			});
		}
	}

	return NextResponse.json({
		settled: settledIds.length,
		settledIds,
		settledCents,
		// Portion of the simplified net debt that only exists via other
		// members and therefore cannot be marked settled here.
		remainingCents: Math.max(0, netDebt.cents - settledCents),
		creditor: toMemberId,
		debtor: fromMemberId,
	});
});
