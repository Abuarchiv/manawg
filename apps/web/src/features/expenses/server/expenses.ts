import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { postChatSystemMessage } from '@/core/activity-feed';
import { recordAuditEvent } from '@/core/audit';
import { db, expenseSplits, expenses, wgMembers } from '@/core/db';
import type { Expense, ExpenseSplit } from '@/core/db/schema';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';
import { isUuid } from '@/core/guards/api-auth';
import type { ResolvedWg } from '@/core/guards/resolve';
import {
	dispatchNotificationSafely,
	type NotificationDispatchWarning,
} from '@/core/notifications/notification-dispatch';
import { formatEuroCents } from '@/core/utils/money';
import { settledAtForOwnShare } from '@/features/expenses/split-math';

interface ExpenseSplitInput {
	debtorMemberId: string;
	amountCents: number;
}

/**
 * Payer identity comes from the request body so the user can record an
 * expense paid by another roommate. Falls back to the authenticated
 * caller only when the body omits the field; a supplied-but-invalid member id
 * returns `null` so the route can reject it instead of silently attributing
 * the expense to the caller.
 */
export function resolveExpensePayer(bodyPaidByMemberId: unknown, callerId: string): string | null {
	if (bodyPaidByMemberId === undefined || bodyPaidByMemberId === null) return callerId;
	if (typeof bodyPaidByMemberId === 'string' && isUuid(bodyPaidByMemberId)) {
		return bodyPaidByMemberId;
	}
	return null;
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
		.where(
			and(
				eq(wgMembers.wgId, wgId),
				inArray(wgMembers.id, memberIds),
				isNull(wgMembers.deactivatedAt),
			),
		);
	return new Set(memberRows.map((row) => row.id));
}

interface InsertExpenseInput {
	wgId: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	category: string;
	imageUrl: string | null;
	occurredAt: Date;
	splits: readonly ExpenseSplitInput[];
	recurringExpenseId?: string;
	recurringDueAt?: Date;
}

/**
 * An expense and its splits are one fact, so they are written in one
 * transaction. A compensating delete would itself be a database call; if it
 * failed, the orphaned expense would skew every balance.
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
			category: input.category,
			imageUrl: input.imageUrl,
			occurredAt: input.occurredAt,
			recurringExpenseId: input.recurringExpenseId,
			recurringDueAt: input.recurringDueAt,
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
				settledAt: settledAtForOwnShare(s.debtorMemberId, input.paidByMemberId),
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
 * Best-effort activity fan-out for a newly created expense: chat system
 * message, audit trail entry and push
 * notification. None of these can undo the expense that already committed,
 * so failures here are logged and swallowed rather than surfaced as a 500.
 */
export async function recordExpenseCreatedSideEffects(
	input: ExpenseCreatedSideEffectsInput,
): Promise<NotificationDispatchWarning> {
	const { wg, actor, expense } = input;
	const amount = formatEuroCents(expense.amountCents, expense.currency);

	await postChatSystemMessage({
		wgId: wg.id,
		kind: 'expense.created',
		payload: {
			expenseId: expense.id,
			actorMemberId: actor.memberId,
			actorName: actor.name,
			description: expense.description,
			amountCents: expense.amountCents,
			currency: expense.currency,
			// Readers of older clients show this German text; current ones format the cents.
			amount,
		},
	});

	await recordAuditEvent({
		wgId: wg.id,
		memberId: actor.memberId,
		eventType: 'expense.created',
		entityType: 'expense',
		entityId: expense.id,
		actorName: actor.name,
		metadata: {
			description: expense.description,
			amountCents: expense.amountCents,
			currency: expense.currency,
			paidByMemberId: expense.paidByMemberId,
		},
	});

	const { warning } = await dispatchNotificationSafely({
		wg,
		event: 'expense.created',
		payload: {
			title: expense.description,
			amountCents: expense.amountCents,
			currency: expense.currency,
			actorName: actor.name,
			expenseId: expense.id,
		},
		excludeMemberId: actor.memberId,
	});
	return warning;
}
