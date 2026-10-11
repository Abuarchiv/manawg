import { db, recurringExpenses } from '@/core/db';
import { UUID_PATTERN } from '@/core/guards/api-auth';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, notFound, rateLimitResponse } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { currencySchema } from '@/core/validators/currency';
import { expenseCategorySchema } from '@/features/expenses/expense-categories';
import { MAX_SPLITS, RECURRING_INTERVAL_MAX_MONTHS } from '@/features/expenses/expense-constants';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
} from '@/features/expenses/expense-schemas';
import { serializeRecurringExpense } from '@/features/expenses/recurring-expenses';
import {
	deleteRecurringTemplate,
	editRecurringTemplate,
	hasEditFields,
} from '@/features/expenses/server/recurring-template-writes';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z.object({
	description: expenseDescriptionSchema.optional(),
	category: expenseCategorySchema.optional(),
	amountCents: expenseAmountSchema.optional(),
	currency: currencySchema.optional(),
	paidByMemberId: z.string().uuid().optional(),
	intervalMonths: z.number().int().min(1).max(RECURRING_INTERVAL_MAX_MONTHS).optional(),
	nextDueAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(expenseSplitSchema).min(1).max(MAX_SPLITS).optional(),
	paused: z.boolean().optional(),
	/** The due date the editor loaded; a booking since then makes the edit stale. */
	expectedNextDueAt: z.string().datetime({ offset: true }).optional(),
});

export const GET = withWgRoute<{ id: string }>(
	'recurring-expense GET',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const rows = await db
			.select()
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		const row = rows[0];
		if (!row) return notFound('recurring_expense_not_found');
		return NextResponse.json({ recurringExpense: serializeRecurringExpense(row) });
	},
);

export const PATCH = withWgRoute<{ id: string }>(
	'recurring-expense PATCH',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');

		const parsed = await parseBody(req, patchSchema, {
			fieldErrors: {
				amountCents: 'amount_invalid',
				currency: 'currency_invalid',
				description: 'description_invalid',
				category: 'category_invalid',
				paidByMemberId: 'member_id_invalid',
				intervalMonths: 'interval_invalid',
				nextDueAt: 'due_date_invalid',
				splits: 'splits_invalid',
				paused: 'paused_invalid',
			},
		});
		if (!parsed.ok) return parsed.response;

		if (parsed.data.currency !== undefined && parsed.data.currency !== 'EUR') {
			return badRequest('recurring_currency_unsupported');
		}
		const hasAnyField = hasEditFields(parsed.data) || parsed.data.paused !== undefined;
		if (!hasAnyField) return badRequest('invalid_body');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `recurring-expense:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		const rows = await db
			.select()
			.from(recurringExpenses)
			.where(and(eq(recurringExpenses.id, id), eq(recurringExpenses.wgId, wgId)))
			.limit(1);
		const template = rows[0];
		if (!template) return notFound('recurring_expense_not_found');
		return editRecurringTemplate({ wgId, member: auth.member }, template, {
			...parsed.data,
			id,
		});
	},
);

export const DELETE = withWgRoute<{ id: string }>(
	'recurring-expense DELETE',
	async (req, { code, id }) => {
		if (!UUID_PATTERN.test(id)) return badRequest('id_invalid');
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;
		const limited = rateLimitResponse(
			await checkRateLimit(wgWriteLimiter, `recurring-expense:${wgId}:${auth.member.memberId}`),
		);
		if (limited) return limited;

		return deleteRecurringTemplate({ wgId, member: auth.member }, id);
	},
);
