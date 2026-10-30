import { desc, eq, getTableColumns } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, expenseSplits, expenses } from '@/core/db';
import { withIdempotentWrite } from '@/core/db/idempotent-write';
import { TransactionAbort } from '@/core/db/transaction';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { badRequest, forbidden, rateLimitResponse, serverError } from '@/core/http/api-errors';
import { parseBody } from '@/core/http/parse-body';
import { readIdempotencyKey, setReplayWarning } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import { checkRateLimit, expensesReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import { isAllowedImageUrlForWg } from '@/core/validators/image-url';
import { checkPaidByGuard } from '@/features/expenses/paid-by-guard';
import {
	createExpenseSchema,
	EXPENSE_CREATE_FIELD_ERRORS,
	type ExpenseCreateInput,
	type ExpenseCreateResponseBody,
	expenseCreateAbortResponse,
	expenseCreateCodec,
	isRecurringDueUniqueViolation,
	replayRecurringBooking,
	writeExpense,
} from '@/features/expenses/server/expense-create';
import {
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/server/expense-payments';
import {
	findExpenseMemberIds,
	recordExpenseCreatedSideEffects,
	resolveExpensePayer,
} from '@/features/expenses/server/expenses';
import { recordRecurringAdvanced } from '@/features/expenses/server/recurring-booking';
import { splitValidationErrorCode, validateSplits } from '@/features/expenses/split-math';

export const GET = withWgRoute('expenses GET', async (req, { code }) => {
	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const wgId = auth.wg.id;

	// Per-member bucket on top of the middleware's per-IP read limit: this
	// returns the WG's whole expense history.
	const limit = rateLimitResponse(
		await checkRateLimit(expensesReadLimiter, `expenses:${wgId}:${auth.member.memberId}`),
		'rate_limited',
	);
	if (limit) return limit;

	const rows = await db
		.select()
		.from(expenses)
		.where(eq(expenses.wgId, wgId))
		.orderBy(desc(expenses.occurredAt), desc(expenses.createdAt), desc(expenses.id));

	// Payments are a pair-level ledger, independent of any expense: after
	// the last expense is deleted, completed repayments still shift balances.
	if (rows.length === 0) {
		return NextResponse.json({
			expenses: [],
			payments: await loadCompletedExpensePayments(wgId),
		});
	}

	// Balances need the full history, so the list stays complete. Splits are
	// joined by WG instead of `inArray(expenseIds)`: one bind parameter per
	// expense would exceed PostgreSQL's 65,535-parameter limit for large WGs.
	const [splits, payments] = await Promise.all([
		db
			.select(getTableColumns(expenseSplits))
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(eq(expenses.wgId, wgId)),
		loadCompletedExpensePayments(wgId),
	]);

	const splitsByExpense = new Map<string, typeof splits>();
	for (const s of splits) {
		const list = splitsByExpense.get(s.expenseId) ?? [];
		list.push(s);
		splitsByExpense.set(s.expenseId, list);
	}

	return NextResponse.json({
		expenses: rows.map((e) => ({
			...e,
			splits: splitsByExpense.get(e.id) ?? [],
		})),
		payments,
	});
});

export const POST = withWgRoute('expenses POST', async (req, { code }) => {
	const parsed = await parseBody(req, createExpenseSchema, {
		fieldErrors: EXPENSE_CREATE_FIELD_ERRORS,
	});
	if (!parsed.ok) return parsed.response;
	const body = parsed.data;
	if ((body.recurringExpenseId === undefined) !== (body.expectedRecurringNextDueAt === undefined)) {
		return badRequest('recurring_expense_fields_required');
	}
	const imageUrl =
		typeof body.imageUrl === 'string' && body.imageUrl.length > 0 ? body.imageUrl : null;
	const splitCheck = validateSplits(body.amountCents, body.splits);
	if (!splitCheck.ok) return badRequest(splitValidationErrorCode(splitCheck.reason));

	const auth = await requireWgMember(req, code);
	if (!auth.ok) return auth.response;
	const { wg, member } = auth;
	if (!isAllowedImageUrlForWg(imageUrl, wg.id)) return badRequest('image_invalid');

	// Replay is scoped by WG and member, so a client-chosen key never reaches another
	// member's response.
	const scope = `expenses-create:${wg.id}:${member.memberId}`;
	const key = readIdempotencyKey(req);
	const input: Omit<ExpenseCreateInput, 'paidByMemberId'> = {
		wgId: wg.id,
		amountCents: body.amountCents,
		currency: body.currency,
		description: body.description,
		category: body.category,
		imageUrl,
		occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
		splits: body.splits,
		...(body.recurringExpenseId && body.expectedRecurringNextDueAt
			? {
					recurring: {
						id: body.recurringExpenseId,
						expectedDueAt: new Date(body.expectedRecurringNextDueAt),
						...(body.expectedRecurringUpdatedAt
							? { expectedUpdatedAt: new Date(body.expectedRecurringUpdatedAt) }
							: {}),
					},
				}
			: {}),
	};
	const prepare = async () => {
		const limited = await checkRateLimit(wgWriteLimiter, `expense:${wg.id}:${member.memberId}`);
		const limitedResponse = rateLimitResponse(limited);
		if (limitedResponse) return { stop: limitedResponse };
		const paidBy = resolveExpensePayer(body.paidByMemberId, member.memberId);
		if (paidBy === null) return { stop: badRequest('member_id_invalid') };
		if (!checkPaidByGuard(paidBy, member.memberId, body.splits).ok) {
			return { stop: forbidden('paid_by_must_include_caller', 'paid_by_must_include_caller') };
		}
		const memberIds = Array.from(new Set([paidBy, ...body.splits.map((s) => s.debtorMemberId)]));
		const foundMemberIds = await findExpenseMemberIds(wg.id, memberIds);
		if (foundMemberIds.size !== memberIds.length) return { stop: badRequest('member_not_in_wg') };
		return { input: { ...input, paidByMemberId: paidBy } };
	};

	const create = () =>
		withIdempotentWrite(
			{
				scope,
				key,
				codec: expenseCreateCodec,
				// The payment lock comes before the claim row and any WG or member row lock.
				inTransaction: (work) => withExpensePaymentLock(wg.id, work),
				prepare,
				retryAfterRollback: (error, attempt) =>
					attempt === 1 && input.recurring && isRecurringDueUniqueViolation(error)
						? replayRecurringBooking(error)
						: null,
			},
			writeExpense,
		);
	let result: Awaited<ReturnType<typeof create>>;
	try {
		result = await create();
	} catch (writeErr) {
		const abortResponse = expenseCreateAbortResponse(writeErr);
		if (abortResponse) return abortResponse;
		if (writeErr instanceof TransactionAbort) return serverError(writeErr.code);
		throw writeErr;
	}
	if (result.kind === 'stopped') return result.response;
	if (result.kind === 'replayed' || !result.context || !('created' in result.context)) {
		return NextResponse.json(result.body, { status: result.status });
	}

	const { created, advanced } = result.context;
	if (advanced) await recordRecurringAdvanced(member.memberId, advanced);
	const warning = await recordExpenseCreatedSideEffects({
		wg,
		actor: { memberId: member.memberId, name: member.name },
		expense: created,
	});
	const written = result.body as ExpenseCreateResponseBody;
	if (!key || warning === null) return NextResponse.json({ ...written, warning });
	try {
		const persisted = await setReplayWarning(
			scope,
			key,
			{
				match: [{ path: ['expense', 'id'], equals: created.id }],
				warningPath: ['warning'],
				replaces: [null],
			},
			warning,
		);
		if (persisted) return NextResponse.json({ ...written, warning });
		logApiError('[expenses POST] warning replay update missed', new Error('replay_warning_missed'));
	} catch (err) {
		logApiError('[expenses POST] warning replay update failed', err);
	}
	return NextResponse.json(written);
});
