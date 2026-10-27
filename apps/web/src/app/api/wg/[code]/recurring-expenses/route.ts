import { recordAuditEvent } from '@/core/audit';
import { db, recurringExpenses, wgMembers } from '@/core/db';
import { bodyCodec, withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	badRequest,
	forbidden,
	notFound,
	rateLimitResponse,
	serverError,
} from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { currencySchema } from '@/core/validators/currency';
import {
	isRecurringAnchorAllowed,
	recurringDueAtSchema,
} from '@/core/validators/recurring-due-date';
import { expenseCategorySchema } from '@/features/expenses/expense-categories';
import { MAX_SPLITS, RECURRING_INTERVAL_MAX_MONTHS } from '@/features/expenses/expense-constants';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
} from '@/features/expenses/expense-schemas';
import { checkPaidByGuard } from '@/features/expenses/paid-by-guard';
import { serializeRecurringExpense } from '@/features/expenses/recurring-expenses';
import { withExpensePaymentLock } from '@/features/expenses/server/expense-payments';
import {
	advanceRecurringTemplate,
	deleteRecurringTemplate,
	editRecurringTemplate,
	hasEditFields,
} from '@/features/expenses/server/recurring-template-writes';
import { splitValidationErrorCode, validateSplits } from '@/features/expenses/split-math';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const RECURRING_EXPENSES_LIST_LIMIT = 500;

type RecurringCreateResponseBody = { recurringExpense: unknown };

const recurringCreateCodec = bodyCodec(
	(body): body is RecurringCreateResponseBody =>
		body !== null && typeof body === 'object' && 'recurringExpense' in body,
);

const EXPENSE_FIELD_ERRORS = {
	amountCents: 'amount_invalid',
	currency: 'currency_invalid',
	description: 'description_invalid',
	category: 'category_invalid',
	paidByMemberId: 'member_id_invalid',
	intervalMonths: 'interval_invalid',
} as const;

const createRecurringSchema = z.object({
	description: expenseDescriptionSchema,
	category: expenseCategorySchema,
	amountCents: expenseAmountSchema,
	currency: currencySchema.optional().default('EUR'),
	paidByMemberId: z.string().uuid(),
	intervalMonths: z.number().int().min(1).max(RECURRING_INTERVAL_MAX_MONTHS).default(1),
	nextDueAt: recurringDueAtSchema,
	/** Unclamped start day; later due dates keep its day-of-month. */
	anchorAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS),
});

const advanceSchema = z.object({
	id: z.string().uuid(),
	description: expenseDescriptionSchema.optional(),
	category: expenseCategorySchema.optional(),
	amountCents: expenseAmountSchema.optional(),
	currency: currencySchema.optional(),
	paidByMemberId: z.string().uuid().optional(),
	intervalMonths: z.number().int().min(1).max(RECURRING_INTERVAL_MAX_MONTHS).optional(),
	nextDueAt: z.string().datetime({ offset: true }).optional(),
	expectedNextDueAt: z.string().datetime({ offset: true }).optional(),
	expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS).optional(),
});

const deleteRecurringSchema = z.object({
	id: z.string().uuid(),
});

export const GET = withWgRoute('recurring-expenses GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const rows = await db
		.select()
		.from(recurringExpenses)
		.where(eq(recurringExpenses.wgId, wg.id))
		.orderBy(asc(recurringExpenses.nextDueAt))
		.limit(RECURRING_EXPENSES_LIST_LIMIT);
	return NextResponse.json({ recurringExpenses: rows.map(serializeRecurringExpense) });
});

export const POST = withWgRoute('recurring-expenses POST', async (req, { code }) => {
	const parsed = await parseBody(req, createRecurringSchema, {
		fieldErrors: {
			...EXPENSE_FIELD_ERRORS,
			nextDueAt: 'due_date_invalid',
			anchorAt: 'due_date_invalid',
			splits: 'splits_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const input = parsed.data;
	if (input.anchorAt !== undefined && !isRecurringAnchorAllowed(input.anchorAt, input.nextDueAt)) {
		return badRequest('due_date_invalid');
	}
	if (input.currency !== 'EUR') return badRequest('recurring_currency_unsupported');
	const splitCheck = validateSplits(input.amountCents, input.splits);
	if (!splitCheck.ok) {
		return badRequest(splitValidationErrorCode(splitCheck.reason));
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		const member = auth.member;

		const result = await withIdempotentWrite(
			{
				scope: `recurring-expenses-create:${wg.id}:${member.memberId}`,
				key: readIdempotencyKey(req),
				codec: recurringCreateCodec,
				inTransaction: (work) => withExpensePaymentLock(wg.id, work),
				prepare: async () => {
					const limited = rateLimitResponse(
						await checkRateLimit(wgWriteLimiter, `recurring-expense:${wg.id}:${member.memberId}`),
					);
					if (limited) return { stop: limited };
					if (!checkPaidByGuard(input.paidByMemberId, member.memberId, input.splits).ok) {
						return {
							stop: forbidden('paid_by_must_include_caller', 'paid_by_must_include_caller'),
						};
					}
					const memberIds = Array.from(
						new Set([input.paidByMemberId, ...input.splits.map((split) => split.debtorMemberId)]),
					);
					const memberRows = await db
						.select({ id: wgMembers.id })
						.from(wgMembers)
						.where(
							and(
								eq(wgMembers.wgId, wg.id),
								inArray(wgMembers.id, memberIds),
								isNull(wgMembers.deactivatedAt),
							),
						);
					return memberRows.length === memberIds.length
						? { input: undefined }
						: { stop: badRequest('member_not_in_wg') };
				},
			},
			async (tx) => {
				const [template] = await tx
					.insert(recurringExpenses)
					.values({
						wgId: wg.id,
						createdByMemberId: member.memberId,
						paidByMemberId: input.paidByMemberId,
						description: input.description,
						category: input.category,
						amountCents: input.amountCents,
						intervalMonths: input.intervalMonths,
						nextDueAt: new Date(input.nextDueAt),
						anchorAt: new Date(input.anchorAt ?? input.nextDueAt),
						splitsJson: JSON.stringify(input.splits),
					})
					.returning();
				if (!template) throw new TransactionAbort('insert_failed');
				const body: RecurringCreateResponseBody = {
					recurringExpense: serializeRecurringExpense(template),
				};
				return { status: 200, body, context: template };
			},
		);
		if (result.kind === 'stopped') return result.response;
		if (result.kind === 'written' && result.context) {
			const template = result.context;
			await recordAuditEvent({
				wgId: wg.id,
				memberId: member.memberId,
				eventType: 'recurring.created',
				entityType: 'recurring_expense',
				entityId: template.id,
				summary: `${member.name} hat ${template.description} als Fixkosten-Vorlage angelegt.`,
				metadata: {
					description: template.description,
					amountCents: template.amountCents,
					currency: 'EUR',
					intervalMonths: template.intervalMonths,
					nextDueAt: template.nextDueAt.toISOString(),
					splitCount: input.splits.length,
				},
			});
		}
		return NextResponse.json(result.body, { status: result.status });
	} catch (err) {
		if (err instanceof TransactionAbort) {
			logApiError('[recurring-expenses POST] transaction aborted');
			return serverError('transaction_aborted');
		}
		throw err;
	}
});

export const PATCH = withWgRoute('recurring-expenses PATCH', async (req, { code }) => {
	const parsed = await parseBody(req, advanceSchema, {
		fieldErrors: {
			...EXPENSE_FIELD_ERRORS,
			nextDueAt: 'due_date_invalid',
			expectedNextDueAt: 'due_date_invalid',
			expectedUpdatedAt: 'expected_updated_at_invalid',
			splits: 'splits_invalid',
		},
	});
	if (!parsed.ok) return parsed.response;
	const edit = parsed.data;
	if (edit.currency !== undefined && edit.currency !== 'EUR') {
		return badRequest('recurring_currency_unsupported');
	}
	const isTemplateUpdate = hasEditFields(edit);
	if (isTemplateUpdate && edit.splits) {
		// amountCents may be omitted on a partial update (kept from the template); the splits'
		// own sum stands in, so only shape issues (duplicates, invalid amounts) are caught here.
		// The sum-vs-amount check runs once the template's current amount is known.
		const effectiveAmount =
			edit.amountCents ?? edit.splits.reduce((total, split) => total + split.amountCents, 0);
		const splitCheck = validateSplits(effectiveAmount, edit.splits);
		if (!splitCheck.ok) {
			return badRequest(splitValidationErrorCode(splitCheck.reason));
		}
	}
	if (!isTemplateUpdate && !edit.expectedNextDueAt) {
		return badRequest('due_date_invalid');
	}
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `recurring-expense:${wg.id}:${auth.member.memberId}`),
	);
	if (limited) return limited;
	const rows = await db
		.select()
		.from(recurringExpenses)
		.where(and(eq(recurringExpenses.id, edit.id), eq(recurringExpenses.wgId, wg.id)))
		.limit(1);
	const template = rows[0];
	if (!template) return notFound('recurring_expense_not_found');
	const caller = { wgId: wg.id, member: auth.member };
	return isTemplateUpdate
		? editRecurringTemplate(caller, template, edit)
		: advanceRecurringTemplate(caller, template, edit.expectedNextDueAt);
});

export const DELETE = withWgRoute('recurring-expenses DELETE', async (req, { code }) => {
	const parsed = await parseBody(req, deleteRecurringSchema, { fieldErrors: { id: 'id_invalid' } });
	if (!parsed.ok) return parsed.response;
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wg = auth.wg;
	const limited = rateLimitResponse(
		await checkRateLimit(wgWriteLimiter, `recurring-expense:${wg.id}:${auth.member.memberId}`),
	);
	if (limited) return limited;

	return deleteRecurringTemplate({ wgId: wg.id, member: auth.member }, parsed.data.id);
});
