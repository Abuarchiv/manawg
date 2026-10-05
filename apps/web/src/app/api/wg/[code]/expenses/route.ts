import { db, expenseSplits, expenses, idempotencyResponses, recurringExpenses } from '@/core/db';
import {
	completeClaimedResponse,
	lockClaimedResponse,
	releaseClaimedResponse,
} from '@/core/db/claimed-response';
import { assertPrivateImageCanBeAttached } from '@/core/db/private-image-deletions';
import { type DbTransaction, TransactionAbort } from '@/core/db/transaction';
import {
	ReplayCache,
	type ReplayReservation,
	claimReplaySlotWithRetry,
	replayKey,
} from '@/core/guards/idempotency';
import { requireWgMember } from '@/core/guards/require-wg-member';
import { withWgRoute } from '@/core/guards/with-wg-route';
import {
	apiError,
	badRequest,
	conflict,
	notFound,
	serverError,
	tooMany,
	unreadableJsonBody,
} from '@/core/http/api-errors';
import { readJsonLimited } from '@/core/http/read-json';
import { getCachedResponse, readIdempotencyKey } from '@/core/idempotency-store';
import { logApiError } from '@/core/infra/observability';
import type { NotificationDispatchWarning } from '@/core/notifications/notification-dispatch';
import { checkRateLimit, expensesReadLimiter, wgWriteLimiter } from '@/core/rate-limit';
import { currencySchema } from '@/core/validators/currency';
import { imageUrlSchema, isAllowedImageUrlForWg } from '@/core/validators/image-url';
import { MAX_SPLITS } from '@/features/expenses/expense-constants';
import {
	hasCapturingExpensePayment,
	loadCompletedExpensePayments,
	withExpensePaymentLock,
} from '@/features/expenses/expense-payments';
import {
	expenseAmountSchema,
	expenseDescriptionSchema,
	expenseSplitSchema,
} from '@/features/expenses/expense-schemas';
import {
	findExpenseMemberIds,
	insertExpenseWithSplits,
	recordExpenseCreatedSideEffects,
	resolveExpensePayer,
} from '@/features/expenses/expenses';
import { checkPaidByGuard } from '@/features/expenses/paid-by-guard';
import { splitValidationErrorCode, validateSplits } from '@/features/expenses/split-math';
import { and, desc, eq, getTableColumns, gt, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type ExpenseCreateResponseBody = { expense: unknown; warning: NotificationDispatchWarning };

const expenseCreateReplay = new ReplayCache<ExpenseCreateResponseBody>();

function expenseCreateIdempotencyScope(wgId: string, memberId: string): string {
	return `expenses-create:${wgId}:${memberId}`;
}

const createExpenseSchema = z
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
		// Structural shape alone would accept splits whose total does not match
		// the expense. The runtime validateSplits call below stays the source of
		// truth for duplicates/invalid amounts, but a bypassed or reordered
		// check can no longer produce a money-mismatched expense: the schema
		// itself refuses it and reports the same error code the runtime check
		// would have returned.
		const sum = value.splits.reduce((total, split) => total + split.amountCents, 0);
		if (sum !== value.amountCents) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'splits_sum_mismatch',
				path: ['splits'],
			});
		}
	});

function isExpenseCreateResponseBody(body: unknown): body is ExpenseCreateResponseBody {
	return body !== null && typeof body === 'object' && 'expense' in body;
}

async function findRecurringExpense(
	tx: DbTransaction,
	wgId: string,
	recurringExpenseId: string,
	recurringDueAt: Date,
): Promise<{
	expense: typeof expenses.$inferSelect;
	splits: (typeof expenseSplits.$inferSelect)[];
} | null> {
	const [expense] = await tx
		.select()
		.from(expenses)
		.where(
			and(
				eq(expenses.wgId, wgId),
				eq(expenses.recurringExpenseId, recurringExpenseId),
				eq(expenses.recurringDueAt, recurringDueAt),
			),
		)
		.limit(1);
	if (!expense) return null;
	const splits = await tx
		.select()
		.from(expenseSplits)
		.where(eq(expenseSplits.expenseId, expense.id));
	return { expense, splits };
}

function expenseCreateAbortResponse(error: unknown): NextResponse | null {
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

function isRecurringDueUniqueViolation(error: unknown): boolean {
	const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
	if (!cause || typeof cause !== 'object') return false;
	const pgError = cause as { code?: unknown; constraint?: unknown; constraint_name?: unknown };
	return (
		pgError.code === '23505' &&
		(pgError.constraint === 'expenses_recurring_due_unique_idx' ||
			pgError.constraint_name === 'expenses_recurring_due_unique_idx')
	);
}

export const GET = withWgRoute(
	'expenses GET',
	async (req, { code }) => {
		const auth = await requireWgMember(req, code);
		if (!auth.ok) return auth.response;
		const wgId = auth.wg.id;

		// Per-member bucket on top of the middleware's per-IP read limit: this
		// returns the WG's whole expense history.
		const limit = await checkRateLimit(
			expensesReadLimiter,
			`expenses:${wgId}:${auth.member.memberId}`,
		);
		if (!limit.success) return tooMany('rate_limited');

		const rows = await db
			.select()
			.from(expenses)
			.where(eq(expenses.wgId, wgId))
			.orderBy(desc(expenses.occurredAt));

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
	},
	{
		fixture: () => {
			return NextResponse.json({ expenses: [], payments: [] });
		},
	},
);

export const POST = withWgRoute('expenses POST', async (req, { code }) => {
	let raw: unknown;
	let replayReservation: Extract<
		ReplayReservation<ExpenseCreateResponseBody>,
		{ owned: true }
	> | null = null;

	try {
		raw = await readJsonLimited(req);
	} catch (err) {
		return unreadableJsonBody(err);
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
		if (issues.fieldErrors.recurringExpenseId) return badRequest('recurring_expense_invalid');
		if (issues.fieldErrors.expectedRecurringNextDueAt)
			return badRequest('recurring_due_at_invalid');
		if (issues.fieldErrors.splits) {
			// The schema-level sum check uses the runtime error code as its
			// message, so the API contract stays identical for clients.
			if (issues.fieldErrors.splits[0] === 'splits_sum_mismatch') {
				return badRequest('splits_sum_mismatch');
			}
			return badRequest('splits_invalid');
		}
		return badRequest('invalid_body');
	}
	if (
		(parsed.data.recurringExpenseId === undefined) !==
		(parsed.data.expectedRecurringNextDueAt === undefined)
	) {
		return badRequest('recurring_expense_fields_required');
	}

	const {
		amountCents,
		description,
		currency,
		imageUrl,
		occurredAt: occurredAtStr,
		splits: validatedSplits,
		paidByMemberId,
		recurringExpenseId,
		expectedRecurringNextDueAt,
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
		if (paidBy === null) return badRequest('member_id_invalid');
		const debtorIds = Array.from(new Set(validatedSplits.map((s) => s.debtorMemberId)));

		const guard = checkPaidByGuard(paidBy, auth.member.memberId, validatedSplits);
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

		// Keep the expense, its splits and its durable replay response in one transaction.
		let written:
			| { replayed: true; body: ExpenseCreateResponseBody }
			| {
					replayed: false;
					expense: typeof expenses.$inferSelect;
					body: ExpenseCreateResponseBody;
			  };
		// Lease of the claim this request locked, and the error its transaction
		// callback threw: drizzle rethrows that error only after ROLLBACK succeeded.
		let claimLease: Date | null = null;
		const rollback = { failed: false, error: undefined as unknown };
		const writeExpense = async (tx: DbTransaction): Promise<typeof written> => {
			if (idemScope && idemKey) {
				const claim = await lockClaimedResponse(
					tx,
					idemScope,
					idemKey,
					isExpenseCreateResponseBody,
				);
				if (claim.kind === 'completed') return { replayed: true, body: claim.body };
				claimLease = claim.leaseExpiresAt;
			}
			await assertPrivateImageCanBeAttached(tx, wg.id, safeImageUrl);

			let recurringDueAt: Date | undefined;
			if (recurringExpenseId && expectedRecurringNextDueAt) {
				const expectedDueAt = new Date(expectedRecurringNextDueAt);
				const existing = await findRecurringExpense(tx, wg.id, recurringExpenseId, expectedDueAt);
				if (existing) {
					const body: ExpenseCreateResponseBody = {
						expense: { ...existing.expense, splits: existing.splits },
						warning: null,
					};
					if (idemScope && idemKey && claimLease) {
						await completeClaimedResponse(tx, idemScope, idemKey, body, claimLease);
					}
					return { replayed: true as const, body };
				}

				const [template] = await tx
					.select()
					.from(recurringExpenses)
					.where(
						and(eq(recurringExpenses.id, recurringExpenseId), eq(recurringExpenses.wgId, wg.id)),
					)
					.limit(1)
					.for('update');
				if (!template) throw new TransactionAbort('recurring_expense_not_found');
				if (template.pausedAt) throw new TransactionAbort('abo_paused');
				if (template.nextDueAt.getTime() !== expectedDueAt.getTime()) {
					throw new TransactionAbort('recurring_expense_already_advanced');
				}
				recurringDueAt = template.nextDueAt;
			}
			if (await hasCapturingExpensePayment(tx, wg.id)) {
				throw new TransactionAbort('paypal_payment_pending');
			}
			const created = await insertExpenseWithSplits(tx, {
				wgId: wg.id,
				paidByMemberId: paidBy,
				amountCents,
				currency,
				description,
				imageUrl: safeImageUrl,
				occurredAt,
				splits: validatedSplits,
				...(recurringExpenseId && recurringDueAt ? { recurringExpenseId, recurringDueAt } : {}),
			});
			const body: ExpenseCreateResponseBody = {
				expense: { ...created.expense, splits: created.splits },
				warning: null,
			};
			if (idemScope && idemKey && claimLease) {
				await completeClaimedResponse(tx, idemScope, idemKey, body, claimLease);
			}
			return { replayed: false as const, expense: created.expense, body };
		};
		try {
			written = await withExpensePaymentLock(wg.id, async (tx) => {
				try {
					return await writeExpense(tx);
				} catch (err) {
					rollback.failed = true;
					rollback.error = err;
					throw err;
				}
			});
		} catch (writeErr) {
			if (
				recurringExpenseId &&
				expectedRecurringNextDueAt &&
				isRecurringDueUniqueViolation(writeErr)
			) {
				const replayed = await withExpensePaymentLock(wg.id, async (tx) => {
					if (idemScope && idemKey) {
						const claim = await lockClaimedResponse(
							tx,
							idemScope,
							idemKey,
							isExpenseCreateResponseBody,
						);
						if (claim.kind === 'completed') return claim.body;
						claimLease = claim.leaseExpiresAt;
					}
					const existing = await findRecurringExpense(
						tx,
						wg.id,
						recurringExpenseId,
						new Date(expectedRecurringNextDueAt),
					);
					if (!existing) return null;
					const body: ExpenseCreateResponseBody = {
						expense: { ...existing.expense, splits: existing.splits },
						warning: null,
					};
					if (idemScope && idemKey && claimLease) {
						await completeClaimedResponse(tx, idemScope, idemKey, body, claimLease);
					}
					return body;
				});
				if (replayed) {
					replayReservation?.resolve(replayed);
					return NextResponse.json(replayed);
				}
			}

			// The write rolled back: free the claim so a same-key retry runs at once.
			if (idemScope && idemKey && claimLease && rollback.failed && rollback.error === writeErr) {
				await releaseClaimedResponse(idemScope, idemKey, claimLease);
			}
			replayReservation?.reject(writeErr);
			const abortResponse = expenseCreateAbortResponse(writeErr);
			if (abortResponse) return abortResponse;
			if (writeErr instanceof TransactionAbort) return serverError(writeErr.code);
			throw writeErr;
		}
		if (written.replayed) {
			replayReservation?.resolve(written.body);
			return NextResponse.json(written.body);
		}

		const warning = await recordExpenseCreatedSideEffects({
			wg,
			actor: { memberId: auth.member.memberId, name: auth.member.name },
			expense: written.expense,
		});

		let responseBody = { ...written.body, warning };
		if (idemScope && idemKey && warning !== null) {
			try {
				const rows = await db
					.update(idempotencyResponses)
					.set({
						responseBody: sql`jsonb_set(${idempotencyResponses.responseBody}, '{warning}', to_jsonb(${warning}::text))`,
					})
					.where(
						and(
							eq(idempotencyResponses.scope, idemScope),
							eq(idempotencyResponses.key, idemKey),
							gt(idempotencyResponses.expiresAt, new Date()),
							sql`${idempotencyResponses.responseBody}->'expense'->>'id' = ${written.expense.id}`,
							sql`${idempotencyResponses.responseBody}->'warning' = 'null'::jsonb`,
						),
					)
					.returning({ scope: idempotencyResponses.scope });
				if (rows.length !== 1) {
					responseBody = written.body;
					logApiError(
						'[expenses POST] warning replay update missed',
						new Error('replay_warning_missed'),
					);
				}
			} catch (err) {
				responseBody = written.body;
				logApiError('[expenses POST] warning replay update failed', err);
			}
		}
		replayReservation?.resolve(responseBody);
		return NextResponse.json(responseBody);
	} catch (err) {
		replayReservation?.reject(err);
		const recurringErrorResponse = expenseCreateAbortResponse(err);
		if (recurringErrorResponse) return recurringErrorResponse;
		logApiError('[expenses POST]', err);
		return serverError(err);
	}
});
