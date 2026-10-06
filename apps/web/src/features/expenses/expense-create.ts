import { expenseSplits, expenses, recurringExpenses } from '@/core/db';
import { bodyCodec } from '@/core/db/idempotent-write';
import { assertPrivateImageCanBeAttached } from '@/core/db/private-image-deletions';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';
import { badRequest, conflict, notFound } from '@/core/http/api-errors';
import type { NotificationDispatchWarning } from '@/core/notifications/notification-dispatch';
import { currencySchema } from '@/core/validators/currency';
import { imageUrlSchema } from '@/core/validators/image-url';
import { MAX_SPLITS } from '@/features/expenses/expense-constants';
import { hasCapturingExpensePayment } from '@/features/expenses/expense-payments';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
} from '@/features/expenses/expense-schemas';
import { insertExpenseWithSplits } from '@/features/expenses/expenses';
import { and, eq } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

export type ExpenseCreateResponseBody = { expense: unknown; warning: NotificationDispatchWarning };
type ExpenseRow = typeof expenses.$inferSelect;
type Split = { debtorMemberId: string; amountCents: number };

export const expenseCreateCodec = bodyCodec(
	(body): body is ExpenseCreateResponseBody =>
		body !== null && typeof body === 'object' && 'expense' in body,
);

export const createExpenseSchema = z
	.object({
		paidByMemberId: z.string().uuid().optional(),
		amountCents: expenseAmountSchema,
		currency: currencySchema.optional().default('EUR'),
		description: expenseDescriptionSchema,
		imageUrl: imageUrlSchema,
		occurredAt: z.string().datetime({ offset: true }).optional(),
		recurringExpenseId: z.string().uuid().optional(),
		expectedRecurringNextDueAt: z.string().datetime({ offset: true }).optional(),
		splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS),
	})
	.superRefine((value, ctx) => {
		// Structural shape alone would accept splits whose total does not match the expense.
		// validateSplits stays the source of truth for duplicates and invalid amounts, but the
		// schema itself refuses a money mismatch and reports the code the runtime check returns.
		const sum = value.splits.reduce((total, split) => total + split.amountCents, 0);
		if (sum !== value.amountCents) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'splits_sum_mismatch',
				path: ['splits'],
			});
		}
	});

/** Request field codes, checked in this order; the sum check reports its own code. */
export const EXPENSE_CREATE_FIELD_ERRORS = {
	amountCents: 'amount_invalid',
	description: 'description_invalid',
	paidByMemberId: 'member_id_invalid',
	currency: 'currency_invalid',
	imageUrl: 'image_invalid',
	occurredAt: 'occurred_at_invalid',
	recurringExpenseId: 'recurring_expense_invalid',
	expectedRecurringNextDueAt: 'recurring_due_at_invalid',
	splits: (messages: string[]) =>
		messages[0] === 'splits_sum_mismatch' ? 'splits_sum_mismatch' : 'splits_invalid',
} as const;

export interface ExpenseCreateInput {
	wgId: string;
	paidByMemberId: string;
	amountCents: number;
	currency: string;
	description: string;
	imageUrl: string | null;
	occurredAt: Date;
	splits: Split[];
	/** A booking of a recurring template's due charge. */
	recurring?: { id: string; expectedDueAt: Date };
}

/** What the route does after commit: side effects for a new expense, nothing for a replay. */
type ExpenseCreateContext = { created: ExpenseRow } | { existing: true };

async function findRecurringExpense(
	tx: DbTransaction,
	wgId: string,
	recurring: { id: string; expectedDueAt: Date },
) {
	const [expense] = await tx
		.select()
		.from(expenses)
		.where(
			and(
				eq(expenses.wgId, wgId),
				eq(expenses.recurringExpenseId, recurring.id),
				eq(expenses.recurringDueAt, recurring.expectedDueAt),
			),
		)
		.limit(1);
	if (!expense) return null;
	const splits = await tx
		.select()
		.from(expenseSplits)
		.where(eq(expenseSplits.expenseId, expense.id));
	return { ...expense, splits };
}

function existingOutcome(expense: unknown) {
	const body: ExpenseCreateResponseBody = { expense, warning: null };
	return { status: 200, body, context: { existing: true } as ExpenseCreateContext };
}

/**
 * Insert the expense and its splits. A booked recurring charge is written once per due date:
 * an existing booking answers instead, and the template must still be due, unpaused and
 * locked for the rest of the transaction. Aborts while a PayPal capture is in flight.
 */
export async function writeExpense(tx: DbTransaction, input: ExpenseCreateInput) {
	await assertPrivateImageCanBeAttached(tx, input.wgId, input.imageUrl);

	let recurringDueAt: Date | undefined;
	if (input.recurring) {
		const existing = await findRecurringExpense(tx, input.wgId, input.recurring);
		if (existing) return existingOutcome(existing);

		const [template] = await tx
			.select()
			.from(recurringExpenses)
			.where(
				and(eq(recurringExpenses.id, input.recurring.id), eq(recurringExpenses.wgId, input.wgId)),
			)
			.limit(1)
			.for('update');
		if (!template) throw new TransactionAbort('recurring_expense_not_found');
		if (template.pausedAt) throw new TransactionAbort('abo_paused');
		if (template.nextDueAt.getTime() !== input.recurring.expectedDueAt.getTime()) {
			throw new TransactionAbort('recurring_expense_already_advanced');
		}
		recurringDueAt = template.nextDueAt;
	}
	if (await hasCapturingExpensePayment(tx, input.wgId)) {
		throw new TransactionAbort('paypal_payment_pending');
	}
	const created = await insertExpenseWithSplits(tx, {
		wgId: input.wgId,
		paidByMemberId: input.paidByMemberId,
		amountCents: input.amountCents,
		currency: input.currency,
		description: input.description,
		imageUrl: input.imageUrl,
		occurredAt: input.occurredAt,
		splits: input.splits,
		...(input.recurring && recurringDueAt
			? { recurringExpenseId: input.recurring.id, recurringDueAt }
			: {}),
	});
	const body: ExpenseCreateResponseBody = {
		expense: { ...created.expense, splits: created.splits },
		warning: null,
	};
	return { status: 200, body, context: { created: created.expense } as ExpenseCreateContext };
}

/**
 * A concurrent booking of the same recurring charge won the unique index; answer with its row.
 * Rethrows `error` when that row is gone after all.
 */
export function replayRecurringBooking(error: unknown) {
	return async (tx: DbTransaction, input: ExpenseCreateInput) => {
		const existing = input.recurring
			? await findRecurringExpense(tx, input.wgId, input.recurring)
			: null;
		if (!existing) throw error;
		return existingOutcome(existing);
	};
}

export function isRecurringDueUniqueViolation(error: unknown): boolean {
	const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
	if (!cause || typeof cause !== 'object') return false;
	const pgError = cause as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
	return (
		pgError.code === '23505' &&
		(pgError.constraint === 'expenses_recurring_due_unique_idx' ||
			pgError.constraint_name === 'expenses_recurring_due_unique_idx')
	);
}

export function expenseCreateAbortResponse(error: unknown): NextResponse | null {
	if (!(error instanceof TransactionAbort)) return null;
	if (error.code === 'image_removed') return conflict('image_removed', 'image_removed');
	if (error.code === 'paypal_payment_pending') return conflict('paypal_payment_pending');
	if (error.code === 'recurring_expense_not_found') return notFound('recurring_expense_not_found');
	if (error.code === 'abo_paused') return badRequest('abo_paused');
	if (error.code === 'recurring_expense_already_advanced') {
		return conflict('recurring_expense_already_advanced');
	}
	return null;
}
