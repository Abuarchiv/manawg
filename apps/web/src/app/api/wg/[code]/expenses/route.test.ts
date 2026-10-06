import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { readIdempotencyKey } from '../../../../../../tests/support/claim-table';
import { mockDb } from '../../../../../../tests/support/db-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';
import { TransactionAbort } from '../../../../../core/db/transaction-abort';

// The create route, its write and replay helpers and the real claim protocol run against
// in-memory expenses, splits, one recurring template and the claim rows. Every write runs on a
// copy that only commits when the payment-lock transaction succeeds.

const wgId = '11111111-1111-4111-8111-111111111111';
const foreignWgId = '99999999-9999-4999-8999-999999999999';
const recurringExpenseId = '22222222-2222-4222-8222-222222222222';
const firstMemberId = '33333333-3333-4333-8333-333333333333';
const secondMemberId = '44444444-4444-4444-8444-444444444444';
const dueAt = '2026-10-01T00:00:00.000Z';

const idempotencyKey = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const KEYS = {
	create: idempotencyKey(1),
	firstMember: idempotencyKey(2),
	secondMember: idempotencyKey(3),
	race: idempotencyKey(4),
	otherUnique: idempotencyKey(5),
	uncertainCommit: idempotencyKey(6),
	reclaimed: idempotencyKey(7),
	revokedImage: idempotencyKey(8),
};

process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
Reflect.deleteProperty(process.env, 'VERCEL_URL');

const expenses = pgTable('expenses', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	paidByMemberId: uuid('paid_by_member_id'),
	amountCents: integer('amount_cents'),
	currency: text('currency'),
	description: text('description'),
	imageUrl: text('image_url'),
	occurredAt: timestamp('occurred_at', { withTimezone: true }),
	recurringExpenseId: uuid('recurring_expense_id'),
	recurringDueAt: timestamp('recurring_due_at', { withTimezone: true }),
});
const expenseSplits = pgTable('expense_splits', {
	id: uuid('id'),
	expenseId: uuid('expense_id'),
	debtorMemberId: uuid('debtor_member_id'),
	amountCents: integer('amount_cents'),
	settledAt: timestamp('settled_at', { withTimezone: true }),
});
const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});
const recurringExpenses = pgTable('recurring_expenses', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	nextDueAt: timestamp('next_due_at', { withTimezone: true }),
	pausedAt: timestamp('paused_at', { withTimezone: true }),
});
const wgMembers = pgTable('wg_members', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

type Body = Record<string, unknown> & { recurringExpenseId?: string; expectedRecurringNextDueAt?: string };
type Row = Record<string, unknown>;
interface ExpenseRow extends Row {
	id: string;
	wgId: string;
	recurringExpenseId?: string;
	recurringDueAt?: Date;
}
interface ClaimRow {
	scope: string;
	key: string;
	body: Row & { _claimed?: boolean; expense?: { id: string } };
	expiresAt: Date;
}
interface Template {
	id: string;
	wgId: string;
	nextDueAt: Date;
	pausedAt: Date | null;
}
interface Local {
	idempotency: Map<string, ClaimRow>;
	expenses: ExpenseRow[];
	splits: Row[];
	template: Template;
	lastFoundExpense: ExpenseRow | null;
}

function defaultBody(overrides: Partial<Body> = {}): Body {
	return {
		paidByMemberId: firstMemberId,
		amountCents: 100,
		currency: 'EUR',
		description: 'Rent',
		imageUrl: null,
		occurredAt: dueAt,
		splits: [
			{ debtorMemberId: firstMemberId, amountCents: 50 },
			{ debtorMemberId: secondMemberId, amountCents: 50 },
		],
		recurringExpenseId,
		expectedRecurringNextDueAt: dueAt,
		...overrides,
	};
}

/** Without these fields the expense is an ordinary, unlinked one. */
const ordinaryBody = () =>
	defaultBody({ recurringExpenseId: undefined, expectedRecurringNextDueAt: undefined });

function createState(options: { templateWgId?: string; templateDueAt?: string; pausedAt?: Date | null }) {
	return {
		capturing: false,
		memberId: firstMemberId,
		body: defaultBody(),
		template: {
			id: recurringExpenseId,
			wgId: options.templateWgId ?? wgId,
			nextDueAt: new Date(options.templateDueAt ?? dueAt),
			pausedAt: options.pausedAt ?? null,
		} as Template,
		members: [
			{ id: firstMemberId, wgId, deactivatedAt: null },
			{ id: secondMemberId, wgId, deactivatedAt: null },
		],
		expenses: [] as ExpenseRow[],
		splits: [] as Row[],
		idempotency: new Map<string, ClaimRow>(),
		idempotencyClaims: [] as { scope: string; key: string; memberId: string }[],
		currentClaimId: null as string | null,
		templateLocks: 0,
		expenseInsertAttempts: 0,
		sideEffects: 0,
		raced: false,
		raceConstraint: null as string | null,
		raceWinner: null as { expense: ExpenseRow; splits: Row[] } | null,
		rejectImageAttachment: false,
		failCommit: false,
		reclaimOnRollback: false,
	};
}

let state = createState({});

function harness(options: Parameters<typeof createState>[0] = {}) {
	state = createState(options);
	return {
		state,
		post: async ({
			memberId = firstMemberId,
			key = KEYS.create,
			body = defaultBody(),
		}: { memberId?: string; key?: string; body?: Body } = {}) => {
			state.memberId = memberId;
			state.body = body;
			member.member = { memberId, name: memberId === firstMemberId ? 'First' : 'Second' };
			return POST(
				request('/api/wg/MTE8PZAT/expenses', {
					method: 'POST',
					headers: { 'Idempotency-Key': key },
					body,
				}),
				routeCtx(),
			);
		},
	};
}

const claimId = (scope: string, key: string) => `${scope}\u0000${key}`;

function selectRows(table: unknown, local: Local): Row[] {
	if (table === idempotencyResponses) {
		const row = local.idempotency.get(state.currentClaimId ?? '');
		return row ? [{ body: row.body, expiresAt: row.expiresAt }] : [];
	}
	if (table === wgMembers) {
		return state.members.filter((candidate) => candidate.wgId === wgId && !candidate.deactivatedAt);
	}
	if (table === expenses) {
		const existing = local.expenses.find(
			(expense) =>
				expense.wgId === wgId &&
				expense.recurringExpenseId === state.body.recurringExpenseId &&
				expense.recurringDueAt?.getTime() === Date.parse(String(state.body.expectedRecurringNextDueAt)),
		);
		local.lastFoundExpense = existing ?? null;
		return existing ? [existing] : [];
	}
	if (table === expenseSplits) {
		const found = local.lastFoundExpense;
		return found ? local.splits.filter((split) => split.expenseId === found.id) : [];
	}
	if (table === recurringExpenses) {
		return local.template?.id === state.body.recurringExpenseId && local.template.wgId === wgId
			? [local.template]
			: [];
	}
	return [];
}

function selectQuery(local: Local, baseDb = false) {
	let table: unknown = null;
	const query = {
		from(selected: unknown) {
			table = selected;
			return query;
		},
		where() {
			if (baseDb || table === expenseSplits) return Promise.resolve(selectRows(table, local));
			return query;
		},
		limit() {
			if (table === expenses) return Promise.resolve(selectRows(table, local));
			return query;
		},
		for() {
			if (table === recurringExpenses) state.templateLocks++;
			return Promise.resolve(selectRows(table, local));
		},
	};
	return query;
}

const committed = (): Local => ({
	idempotency: state.idempotency,
	expenses: state.expenses,
	splits: state.splits,
	template: state.template,
	lastFoundExpense: null,
});

const db = {
	select: () => selectQuery(committed(), true),
	update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
	delete: (table: unknown) => ({
		where: (condition: unknown) => ({
			returning: async () => {
				assert.equal(table, idempotencyResponses);
				const [scope, key, lease] = new PgDialect().sqlToQuery(condition as never).params as [
					string,
					string,
					string,
				];
				const row = state.idempotency.get(claimId(scope, key));
				if (
					!row ||
					JSON.stringify(row.body) !== '{"_claimed":true}' ||
					row.expiresAt.getTime() !== Date.parse(lease)
				) {
					return [];
				}
				state.idempotency.delete(claimId(scope, key));
				return [{ scope }];
			},
		}),
	}),
};

function txFor(local: Local) {
	return {
		select: () => selectQuery(local),
		insert: (table: unknown) => ({
			values: (values: Row | Row[]) => ({
				returning: async () => {
					if (table === expenses) {
						state.expenseInsertAttempts++;
						if (state.raceConstraint && !state.raced) {
							// A concurrent booking commits first and wins the unique index.
							state.raced = true;
							if (state.raceWinner) {
								state.expenses.push(state.raceWinner.expense);
								state.splits.push(...state.raceWinner.splits);
							}
							const error = new Error('duplicate key');
							error.cause = { code: '23505', constraint_name: state.raceConstraint };
							throw error;
						}
						const expense = {
							...(values as Row),
							id: '55555555-5555-4555-8555-555555555555',
							createdAt: new Date(),
							updatedAt: new Date(),
						} as ExpenseRow;
						local.expenses.push(expense);
						return [expense];
					}
					assert.equal(table, expenseSplits);
					const splits = (values as Row[]).map((value, index) => ({
						...value,
						id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`,
					}));
					local.splits.push(...splits);
					return splits;
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: { responseBody: ClaimRow['body']; expiresAt: Date }) => ({
				where: () => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						const claim = local.idempotency.get(state.currentClaimId ?? '');
						if (!claim || claim.body?._claimed !== true) return [];
						claim.body = values.responseBody;
						claim.expiresAt = values.expiresAt;
						return [{ scope: claim.scope }];
					},
				}),
			}),
		}),
		delete: (table: unknown) => ({
			where: () => {
				assert.equal(table, idempotencyResponses);
				return Promise.resolve(local.idempotency.delete(state.currentClaimId ?? ''));
			},
		}),
	};
}

/** The payment-lock transaction: a copy of every row that commits only on success. */
async function withExpensePaymentLock<T>(
	_wgId: string,
	operation: (tx: ReturnType<typeof txFor>) => Promise<T>,
): Promise<T> {
	const local: Local = {
		idempotency: new Map(
			[...state.idempotency].map(([claimKey, row]) => [claimKey, structuredClone(row)]),
		),
		expenses: structuredClone(state.expenses),
		splits: structuredClone(state.splits),
		template: structuredClone(state.template),
		lastFoundExpense: null,
	};
	let result: T;
	try {
		result = await operation(txFor(local));
	} catch (err) {
		if (state.reclaimOnRollback) {
			// Another request took the key over with a fresh lease meanwhile.
			for (const row of state.idempotency.values()) {
				row.expiresAt = new Date(row.expiresAt.getTime() + 60_000);
			}
		}
		throw err;
	}
	if (state.failCommit) throw new Error('commit_outcome_unknown');
	state.idempotency = local.idempotency;
	state.expenses = local.expenses;
	state.splits = local.splits;
	state.template = local.template;
	return result;
}

mockObservability();
mockRateLimit();
const member = mockWgMember({
	wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId: firstMemberId, name: 'First' },
});
mockDb({ db, expenseSplits, expenses, idempotencyResponses, recurringExpenses, wgMembers });
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction: () => assert.fail('expense writes run inside the payment lock'),
		lockExpensePayments: async () => undefined,
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async (scope: string, key: string) => {
			const id = claimId(scope, key);
			state.currentClaimId = id;
			state.idempotencyClaims.push({ scope, key, memberId: state.memberId });
			if (!state.idempotency.has(id)) {
				state.idempotency.set(id, {
					scope,
					key,
					body: { _claimed: true },
					expiresAt: new Date(Date.now() + 300_000),
				});
			}
			return { won: true };
		},
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey,
		claimResponseSlot: async () => true,
		getCachedResponse: async (scope: string, key: string) => {
			const row = state.idempotency.get(claimId(scope, key));
			return row && !row.body?._claimed ? row.body : null;
		},
		setReplayWarning: async () => false,
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		assertPrivateImageCanBeAttached: async () => {
			if (state.rejectImageAttachment) throw new TransactionAbort('image_removed');
		},
	},
});
mock.module('@/features/expenses/expense-payments', {
	namedExports: {
		hasCapturingExpensePayment: async () => state.capturing,
		loadCompletedExpensePayments: async () => [],
		withExpensePaymentLock,
	},
});
mock.module('@/core/activity-feed', {
	namedExports: {
		postChatSystemMessage: async () => undefined,
		postSystemNotice: async () => undefined,
		resolveShoppingRequest: async () => undefined,
	},
});
// The audit entry is the last step of the created-expense side effects.
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: { eventType: string }) => {
			if (event.eventType === 'expense.created') state.sideEffects++;
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});

const { POST } = await import('./route');

test('different members and idempotency keys replay one recurring due after its template advances', async () => {
	const { post } = harness();
	const firstResponse = await post({ memberId: firstMemberId, key: KEYS.firstMember });
	assert.equal(firstResponse.status, 200);
	const canonical = await firstResponse.json();

	state.template.nextDueAt = new Date('2026-11-01T00:00:00.000Z');
	const secondResponse = await post({ memberId: secondMemberId, key: KEYS.secondMember });
	assert.equal(secondResponse.status, 200);
	assert.deepEqual(await secondResponse.json(), canonical);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.splits.length, 2);
	assert.equal(state.expenses[0]?.recurringExpenseId, recurringExpenseId);
	assert.equal(state.expenses[0]?.recurringDueAt?.toISOString(), dueAt);
	assert.equal(state.sideEffects, 1);
	assert.equal(state.templateLocks, 1, 'the existing due is checked before the advanced template');
	assert.deepEqual(
		state.idempotencyClaims.map(({ memberId, key }) => [memberId, key]),
		[
			[firstMemberId, KEYS.firstMember],
			[secondMemberId, KEYS.secondMember],
		],
	);
	assert.ok(
		[...state.idempotency.values()].every((row) => row.body.expense?.id === canonical.expense.id),
		'both durable claims resolve to the canonical expense',
	);
});

test('rejects a one-sided recurring reference', async () => {
	for (const body of [
		defaultBody({ expectedRecurringNextDueAt: undefined }),
		defaultBody({ recurringExpenseId: undefined }),
	]) {
		const { post } = harness();
		const response = await post({ body });
		assert.equal(response.status, 400);
		assert.equal(state.expenseInsertAttempts, 0);
		assert.equal(state.idempotencyClaims.length, 0);
	}
});

test('rejects foreign, stale, and paused recurring templates without creating an expense', async () => {
	const cases = [
		{ options: { templateWgId: foreignWgId }, status: 404, error: 'recurring_expense_not_found' },
		{
			options: { templateDueAt: '2026-10-02T00:00:00.000Z' },
			status: 409,
			error: 'recurring_expense_already_advanced',
		},
		{
			options: { pausedAt: new Date('2026-09-01T00:00:00.000Z') },
			status: 400,
			error: 'abo_paused',
		},
	];
	for (const { options, status, error } of cases) {
		const { post } = harness(options);
		const response = await post();
		assert.equal(response.status, status);
		assert.equal((await response.json()).error, error);
		assert.equal(state.expenses.length, 0);
		assert.equal(state.sideEffects, 0);
		assert.equal(state.idempotency.size, 0, 'invalid recurrence attempts release their durable claim');
	}
});

test('expense creation waits for capture without leaving an idempotency claim', async () => {
	const { post } = harness();
	const body = ordinaryBody();
	state.capturing = true;
	const blocked = await post({ body });
	assert.equal(blocked.status, 409);
	assert.equal((await blocked.json()).error, 'paypal_payment_pending');
	assert.equal(state.expenses.length, 0);
	assert.equal(state.idempotency.size, 0);
	state.capturing = false;
	const retried = await post({ body });
	assert.equal(retried.status, 200);
	assert.equal(state.expenses.length, 1);
});

test('ordinary expenses remain unlinked to recurring templates', async () => {
	const { post } = harness();
	const response = await post({ body: ordinaryBody() });
	assert.equal(response.status, 200);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.expenses[0]?.recurringExpenseId, undefined);
	assert.equal(state.expenses[0]?.recurringDueAt, undefined);
	assert.equal(state.templateLocks, 0);
	assert.equal(state.sideEffects, 1);
});

test('recovers only the recurring due unique-index race with the winning canonical expense', async () => {
	const { post } = harness();
	const winnerId = '77777777-7777-4777-8777-777777777777';
	state.raceWinner = {
		expense: {
			id: winnerId,
			wgId,
			paidByMemberId: firstMemberId,
			amountCents: 100,
			currency: 'EUR',
			description: 'Rent',
			imageUrl: null,
			occurredAt: new Date(dueAt),
			recurringExpenseId,
			recurringDueAt: new Date(dueAt),
		},
		splits: [
			{
				id: '88888888-8888-4888-8888-888888888888',
				expenseId: winnerId,
				debtorMemberId: firstMemberId,
				amountCents: 50,
				settledAt: null,
			},
			{
				id: '99999999-9999-4999-8999-999999999998',
				expenseId: winnerId,
				debtorMemberId: secondMemberId,
				amountCents: 50,
				settledAt: null,
			},
		],
	};
	state.raceConstraint = 'expenses_recurring_due_unique_idx';

	const response = await post({ key: KEYS.race });
	assert.equal(response.status, 200);
	assert.equal((await response.json()).expense.id, winnerId);
	assert.equal(state.expenses.length, 1);
	assert.equal(state.expenses[0]?.amountCents, 100);
	assert.equal(state.splits.length, 2);
	assert.equal(state.sideEffects, 0);
	assert.equal([...state.idempotency.values()][0]?.body.expense?.id, winnerId);
});

test('does not treat a different PostgreSQL unique constraint as a recurring replay', async () => {
	const { post } = harness();
	state.raceConstraint = 'expenses_some_other_unique_idx';
	const response = await post({ key: KEYS.otherUnique });
	assert.equal(response.status, 500);
	assert.equal(state.expenses.length, 0);
	assert.equal(state.sideEffects, 0);
	assert.equal(state.idempotency.size, 0, 'the rolled-back write frees its claim');
});

test('an uncertain COMMIT keeps the expense claim fail-closed', async () => {
	const { post } = harness();
	state.failCommit = true;
	const response = await post({ key: KEYS.uncertainCommit, body: ordinaryBody() });
	assert.equal(response.status, 500);
	assert.deepEqual(
		[...state.idempotency.values()].map((row) => row.body),
		[{ _claimed: true }],
	);
});

test('a rolled-back expense keeps a claim that another request took over', async () => {
	const { post } = harness();
	state.capturing = true;
	state.reclaimOnRollback = true;
	const response = await post({ key: KEYS.reclaimed, body: ordinaryBody() });
	assert.equal(response.status, 409);
	assert.deepEqual(
		[...state.idempotency.values()].map((row) => row.body),
		[{ _claimed: true }],
	);
});

test('revoked private image attachment returns 409 without creating an expense', async () => {
	const { post } = harness();
	state.rejectImageAttachment = true;
	const response = await post({
		key: KEYS.revokedImage,
		body: defaultBody({
			imageUrl:
				'https://app.example/api/upload/read?key=manawg%2F11111111-1111-4111-8111-111111111111%2Fexpense%2F22222222-2222-4222-8222-222222222222.jpg',
		}),
	});
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'image_removed', code: 'image_removed' });
	assert.equal(state.expenses.length, 0);
	assert.equal(state.sideEffects, 0);
});
