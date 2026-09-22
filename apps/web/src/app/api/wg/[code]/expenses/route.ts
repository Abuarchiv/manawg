import { db, expenseSplits, expenses } from '@/core/db';
import type { Expense, ExpenseSplit } from '@/core/db/schema';
import { TransactionAbort } from '@/core/db/transaction';
import { apiError, badRequest, serverError, tooMany } from '@/core/errors';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { readShareCode } from '@/core/guards/route-preamble';
import { withWgRoute } from '@/core/guards/with-wg-route';
import { getCachedResponse, readIdempotencyKey, setCachedResponse } from '@/core/idempotency';
import type { RouteCtx } from '@/core/infra/api-types';
import { logApiError } from '@/core/infra/observability';
import type { NotificationDispatchWarning } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, wgWriteLimiter } from '@/core/rate-limit';
import { currencySchema } from '@/core/validators/currency';
import { imageUrlSchema, isAllowedImageUrlForWg } from '@/core/validators/image-url';
import { AMOUNT_MAX_CENTS, AMOUNT_MIN_CENTS } from '@/features/expenses/expense-constants';
import {
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/expense-payments';
import {
	checkPaidByGuard,
	findExpenseMemberIds,
	insertExpenseWithSplits,
	recordExpenseCreatedSideEffects,
	resolveExpensePayer,
} from '@/features/expenses/expenses';
import { splitValidationErrorCode, validateSplits } from '@/features/expenses/split-math';
import { desc, eq, inArray } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const DESCRIPTION_MIN = 1;
const DESCRIPTION_MAX = 200;
const MAX_SPLITS = 50;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

type ExpenseCreateResponseBody = { expense: unknown; warning: NotificationDispatchWarning };

const expenseCreateReplay = new ReplayCache<ExpenseCreateResponseBody>(IDEMPOTENCY_TTL_MS);

function expenseCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `expenses-create:${wgId}:${memberId}`;
}

const splitSchema = z.object({
	debtorMemberId: z.string().uuid(),
	amountCents: z
		.number()
		.int('amountCents must be an integer')
		.min(0, 'amountCents must not be negative'),
});

const createExpenseSchema = z.object({
	paidByMemberId: z.string().uuid().optional(),
	amountCents: z
		.number()
		.int('amountCents must be an integer')
		.min(AMOUNT_MIN_CENTS)
		.max(AMOUNT_MAX_CENTS),
	currency: currencySchema.optional().default('EUR'),
	description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
	imageUrl: imageUrlSchema,
	occurredAt: z.string().datetime({ offset: true }).optional(),
	splits: z.array(splitSchema).min(1).max(MAX_SPLITS),
});

export const GET = withWgRoute(
	'expenses GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		const rows = await db
			.select()
			.from(expenses)
			.where(eq(expenses.wgId, wgId))
			.orderBy(desc(expenses.occurredAt));

		if (rows.length === 0) return NextResponse.json({ expenses: [] });

		const expenseIds = rows.map((r) => r.id);
		const [splits, payments] = await Promise.all([
			db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds)),
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
	},
	{
		fixture: () => {
			return NextResponse.json({ expenses: [] });
		},
	},
);

export async function POST(
	req: NextRequest,
	ctx: RouteCtx<{ code: string }>,
): Promise<NextResponse> {
	const codeResult = await readShareCode(ctx);
	if (!codeResult.ok) return codeResult.response;
	const { code } = codeResult;

	let raw: unknown;
	let replayReservation: Extract<
		ReplayReservation<ExpenseCreateResponseBody>,
		{ owned: true }
	> | null = null;

	try {
		raw = await req.json();
	} catch {
		return badRequest('invalid_json');
	}

	const idemKey = readIdempotencyKey(req);

	const parsed = createExpenseSchema.safeParse(raw);
	if (!parsed.success) {
		const issues = parsed.error.flatten();
		if (issues.fieldErrors.amountCents) return badRequest('amount_invalid');
		if (issues.fieldErrors.description) return badRequest('description_invalid');
		if (issues.fieldErrors.paidByMemberId) return badRequest('member_id_invalid');
		if (issues.fieldErrors.currency) return badRequest('currency_invalid');
		if (issues.fieldErrors.imageUrl) return badRequest('image_invalid');
		if (issues.fieldErrors.occurredAt) return badRequest('occurred_at_invalid');
		if (issues.fieldErrors.splits) return badRequest('splits_invalid');
		return badRequest('invalid_body');
	}

	const {
		amountCents,
		description,
		currency,
		imageUrl,
		occurredAt: occurredAtStr,
		splits: validatedSplits,
		paidByMemberId,
	} = parsed.data;

	const occurredAt = occurredAtStr ? new Date(occurredAtStr) : new Date();
	const safeImageUrl = typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null;

	const splitCheck = validateSplits(amountCents, validatedSplits);
	if (!splitCheck.ok) {
		return badRequest(splitValidationErrorCode(splitCheck.reason));
	}

	try {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wg = auth.wg;
		if (!isAllowedImageUrlForWg(safeImageUrl, wg.id)) return badRequest('image_invalid');

		const idemScope = idemKey ? expenseCreateIdempotencyScope(wg.id, auth.member.memberId) : null;
		const idemReplayKey = idemScope && idemKey ? replayKey(idemScope, idemKey) : null;

		// Replay only after WG/member auth, scoped by both IDs to prevent
		// cross-WG or cross-member response leaks for client-provided keys.
		if (idemScope && idemKey && idemReplayKey) {
			const localReplay = expenseCreateReplay.get(idemReplayKey);
			if (localReplay) return NextResponse.json(await localReplay);

			const cached = await getCachedResponse<ExpenseCreateResponseBody>(idemScope, idemKey);
			if (cached) {
				expenseCreateReplay.remember(idemReplayKey, cached);
				return NextResponse.json(cached);
			}
		}

		const limited = await checkRateLimit(
			wgWriteLimiter,
			`expense:${wg.id}:${auth.member.memberId}`,
		);
		if (!limited.success) return tooMany();

		const paidBy = resolveExpensePayer(paidByMemberId, auth.member.memberId);
		const debtorIds = Array.from(new Set(validatedSplits.map((s) => s.debtorMemberId)));

		const guard = checkPaidByGuard(paidBy, auth.member.memberId, debtorIds);
		if (!guard.ok) {
			return apiError('paid_by_must_include_caller', 403, 'paid_by_must_include_caller');
		}
		const memberIds = Array.from(new Set([paidBy, ...debtorIds]));
		const foundMemberIds = await findExpenseMemberIds(wg.id, memberIds);
		if (foundMemberIds.size !== memberIds.length) {
			return badRequest('member_not_in_wg');
		}

		const replaySlot = idemReplayKey === null ? null : expenseCreateReplay.reserve(idemReplayKey);
		if (replaySlot?.owned === false) {
			return NextResponse.json(await replaySlot.promise);
		}
		replayReservation = replaySlot;

		// Cross-process dedup: claim a Postgres slot so a concurrent cold Lambda
		// with the same Idempotency-Key sees our claim and fetches the cached
		// response instead of inserting a duplicate expense.
		if (idemScope && idemKey) {
			const slot = await claimReplaySlotWithRetry<ExpenseCreateResponseBody>(idemScope, idemKey);
			if (!slot.won) {
				replayReservation?.resolve(slot.cached);
				return NextResponse.json(slot.cached);
			}
		}

		// An expense and its splits are one fact, so they are written in one
		// transaction. The previous two-step insert compensated by deleting the
		// expense when the splits failed — but that delete is itself a database
		// call, and when it failed the orphan survived and skewed every balance.
		let expense: Expense;
		let splitRows: ExpenseSplit[];
		try {
			const written = await withExpensePaymentLock(wg.id, (tx) =>
				insertExpenseWithSplits(tx, {
					wgId: wg.id,
					paidByMemberId: paidBy,
					amountCents,
					currency,
					description,
					imageUrl: safeImageUrl,
					occurredAt,
					splits: validatedSplits,
				}),
			);
			expense = written.expense;
			splitRows = written.splits;
		} catch (writeErr) {
			replayReservation?.reject(writeErr);
			if (writeErr instanceof TransactionAbort) return serverError(writeErr.code);
			throw writeErr;
		}

		const warning = await recordExpenseCreatedSideEffects({
			wg,
			actor: { memberId: auth.member.memberId, name: auth.member.name },
			expense,
		});

		const responseBody = { expense: { ...expense, splits: splitRows ?? [] }, warning };
		// Cache the exact response body so a retry with the same Idempotency-Key
		// receives the SAME expense.id rather than triggering a duplicate insert.
		// Fire-and-forget: a cache hiccup here only loses cross-process dedup;
		// local same-key retries already share the resolved replay promise.
		if (idemScope && idemKey && replayReservation?.owned) {
			replayReservation.resolve(responseBody);
			void setCachedResponse(idemScope, idemKey, responseBody).catch((err) =>
				console.warn('[expenses POST] idem cache write failed', err),
			);
		}
		return NextResponse.json(responseBody);
	} catch (err) {
		replayReservation?.reject(err);
		logApiError('[expenses POST]', err);
		return serverError(err);
	}
}
