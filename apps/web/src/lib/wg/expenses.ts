import { recordAuditEvent } from '@/core/audit';
import { announcements, db, expenseSplits, expenses, wgMembers } from '@/core/db';
import type { Expense, ExpenseSplit } from '@/core/db/schema';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';
import { isUuid } from '@/core/guards/api-auth';
import type { ResolvedWg } from '@/core/guards/resolve';
import { dispatchNotification } from '@/core/notifications/notification-dispatch';
import { formatEuroCents } from '@/core/utils/money';
import { appendSystemMessage } from '@/lib/wg/chat-server';
import { and, eq, inArray } from 'drizzle-orm';

interface ExpenseSplitInput {
	debtorMemberId: string;
	amountCents: number;
}

/**
 * Payer identity comes from the request body so the user can record an
 * expense paid by another roommate (common: someone forgot their phone /
 * asks Lisa to log "Tom paid for pizza"). Falls back to the authenticated
 * caller when the body value is missing or not a valid member id shape.
 */
export function resolveExpensePayer(bodyPaidByMemberId: unknown, callerId: string): string {
	const bodyPaidBy =
		typeof bodyPaidByMemberId === 'string' && isUuid(bodyPaidByMemberId)
			? bodyPaidByMemberId
			: null;
	return bodyPaidBy ?? callerId;
}

type PaidByGuardResult = { ok: true } | { ok: false; reason: 'paid_by_must_include_caller' };

/**
 * Abuse guard: when the caller logs an expense paid by SOMEONE ELSE, require
 * the caller to also bear a share in the split. This prevents pure
 * fabrication ("Alice silently makes Charlie owe Bob 30€") while still
 * allowing the legitimate "log on behalf of" UX where the caller is part of
 * the cost group. Self-paid expenses (paidBy === caller) are unrestricted.
 * Combined with the audit trail and any-debtor delete permission, this keeps
 * creation honest.
 */
export function checkPaidByGuard(
	paidByMemberId: string,
	callerId: string,
	debtorIds: readonly string[],
): PaidByGuardResult {
	if (paidByMemberId !== callerId && !debtorIds.includes(callerId)) {
		return { ok: false, reason: 'paid_by_must_include_caller' };
	}
	return { ok: true };
}

/**
 * Resolves which of the given member ids actually belong to this WG. Callers
 * compare the returned set's size against the input to detect any id that
 * does not (e.g. a member who already left).
 */
export async function findExpenseMemberIds(
	wgId: string,
	memberIds: readonly string[],
): Promise<Set<string>> {
	const memberRows = await db
		.select({ id: wgMembers.id })
		.from(wgMembers)
		.where(and(eq(wgMembers.wgId, wgId), inArray(wgMembers.id, memberIds)));
	return new Set(memberRows.map((row) => row.id));
}

interface InsertExpenseInput {
	wgId: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	imageUrl: string | null;
	occurredAt: Date;
	splits: readonly ExpenseSplitInput[];
}

/**
 * An expense and its splits are one fact, so they are written in one
 * transaction. The previous two-step insert compensated by deleting the
 * expense when the splits failed — but that delete is itself a database
 * call, and when it failed the orphan survived and skewed every balance.
 *
 * Throws {@link TransactionAbort} on either insert failure so the caller's
 * `withTransaction` rolls back cleanly; callers should run this inside
 * `withTransaction` and map `TransactionAbort` to a 500 response themselves.
 */
export async function insertExpenseWithSplits(
	tx: DbTransaction,
	input: InsertExpenseInput,
): Promise<{ expense: Expense; splits: ExpenseSplit[] }> {
	const [created] = await tx
		.insert(expenses)
		.values({
			wgId: input.wgId,
			paidByMemberId: input.paidByMemberId,
			amountCents: input.amountCents,
			currency: input.currency,
			description: input.description,
			imageUrl: input.imageUrl,
			occurredAt: input.occurredAt,
		})
		.returning();
	if (!created) throw new TransactionAbort('insert_failed');

	const splitRows = await tx
		.insert(expenseSplits)
		.values(
			input.splits.map((s) => ({
				expenseId: created.id,
				debtorMemberId: s.debtorMemberId,
				amountCents: s.amountCents,
			})),
		)
		.returning();
	if (splitRows.length === 0) throw new TransactionAbort('split_insert_failed');

	return { expense: created, splits: splitRows };
}

interface ExpenseCreatedSideEffectsInput {
	wg: ResolvedWg;
	actor: { memberId: string; name: string };
	expense: Expense;
}

/**
 * Best-effort activity fan-out for a newly created expense: pinnwand
 * announcement, chat system message, audit trail entry and push
 * notification. None of these can undo the expense that already committed,
 * so failures here are logged and swallowed rather than surfaced as a 500.
 */
export async function recordExpenseCreatedSideEffects(
	input: ExpenseCreatedSideEffectsInput,
): Promise<void> {
	const { wg, actor, expense } = input;
	const amount = formatEuroCents(expense.amountCents, expense.currency);

	try {
		await db.insert(announcements).values({
			wgId: wg.id,
			authorMemberId: actor.memberId,
			kind: 'info',
			source: 'expense',
			sourcePath: `/ausgaben?highlight=${encodeURIComponent(expense.id)}`,
			content: `${actor.name} hat eine Ausgabe eingetragen: ${expense.description} (${amount}).`,
		});
	} catch (announcementErr) {
		console.warn('[expenses] system announcement failed', announcementErr);
	}

	void appendSystemMessage({
		wgId: wg.id,
		kind: 'expense.created',
		payload: {
			expenseId: expense.id,
			actorName: actor.name,
			description: expense.description,
			amount,
		},
	}).catch((err) => console.warn('[expenses] chat system message failed', err));

	await recordAuditEvent({
		wgId: wg.id,
		memberId: actor.memberId,
		eventType: 'expense.created',
		entityType: 'expense',
		entityId: expense.id,
		summary: `${actor.name} hat ${expense.description} eingetragen.`,
		metadata: { amountCents: expense.amountCents, paidByMemberId: expense.paidByMemberId },
	});

	void dispatchNotification({
		wg,
		event: 'expense.created',
		payload: {
			title: expense.description,
			amountCents: expense.amountCents,
			actorName: actor.name,
			expenseId: expense.id,
		},
		excludeMemberId: actor.memberId,
	}).catch((err) => console.error('[expenses] notification failed', err));
}
