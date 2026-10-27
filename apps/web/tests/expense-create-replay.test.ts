import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import { delegate } from './support/expense-route-fakes.ts';

// Expense and recurring-template creation commit exactly once per idempotency key and replay the
// stored response [suite "expense create replay atomic"]. The fake transaction
// applies its writes to the shared state only when the operation resolves.

const schema = await import('../src/core/db/schema.ts');
const { idempotencyResponses, recurringExpenses } = schema;

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const SPLIT_ID = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
const KEY = 'retry-key';

type Kind = 'expense' | 'recurring';
type ReplayRow = { body: Record<string, unknown>; expiresAt: Date };
type Harness = ReturnType<typeof createHarness>;

let current: Harness;

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			current.state.sideEffects += 1;
		},
	},
});
mock.module('@/core/db', { namedExports: { ...schema, db: delegate(() => current.db) } });
mock.module('@/core/db/private-image-deletions', {
	namedExports: { assertPrivateImageCanBeAttached: async () => undefined },
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort, withTransaction: async () => assert.fail('no plain tx') },
});
mock.module('@/core/guards/admin', {
	namedExports: { requireOwnerOrAdmin: async () => null },
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f-]{36}$/i,
		isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			const { state } = current;
			state.slot ??= { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
			return { won: true };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: WG_ID, shareCode: 'MTE8PZAT', name: 'WG' },
			member: { memberId: MEMBER_ID, name: 'Mina' },
		}),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => undefined,
		logApiError: (message: string, err: unknown) => {
			current.state.errors.push(`${message}: ${String(err)}`);
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		expensesReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		loadCompletedExpensePayments: async () => [],
		withExpensePaymentLock: (...args: [string, (tx: unknown) => Promise<unknown>]) =>
			current.withExpensePaymentLock(...args),
	},
});
mock.module('@/features/expenses/server/expenses', {
	namedExports: {
		findExpenseMemberIds: async () => new Set([MEMBER_ID]),
		insertExpenseWithSplits: async (
			tx: { addExpense: () => void },
			input: Record<string, unknown>,
		) => {
			tx.addExpense();
			return {
				expense: { id: EXPENSE_ID, ...input },
				splits: [
					{ id: SPLIT_ID, expenseId: EXPENSE_ID, debtorMemberId: MEMBER_ID, amountCents: 1200 },
				],
			};
		},
		recordExpenseCreatedSideEffects: async () => {
			current.state.sideEffects += 1;
			return current.warning;
		},
		resolveExpensePayer: (_payer: unknown, caller: string) => caller,
	},
});

// The real replay-warning writer, bound to the fake database through the mocked `@/core/db`.
const { setReplayWarning } = await import('../src/core/idempotency-store.ts');
mock.module('@/core/idempotency-store', {
	namedExports: {
		RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60,
		getCachedResponse: async () => null,
		claimResponseSlot: async () => true,
		readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
		setReplayWarning,
	},
});

const expenseRoute = await import('../src/app/api/wg/[code]/expenses/route.ts');
const recurringRoute = await import('../src/app/api/wg/[code]/recurring-expenses/route.ts');

function createHarness(kind: Kind, warning: null | 'notification_delivery_failed' = null) {
	const dialect = new PgDialect();
	const state = {
		slot: {
			body: { _claimed: true },
			expiresAt: new Date(Date.now() + 60_000),
		} as ReplayRow | null,
		created: [] as string[],
		sideEffects: 0,
		failBaseWrite: false,
		warningWrite: 'success' as 'success' | 'miss' | 'throw',
		baseWhere: '',
		warningWhere: '',
		warningSet: '',
		warningSetHasExpiry: false,
		errors: [] as string[],
	};
	let tail = Promise.resolve();
	const withExpensePaymentLock = async (
		_wgId: string,
		operation: (tx: unknown) => Promise<unknown>,
	) => {
		const previous = tail;
		let release: () => void = () => undefined;
		tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		const draft = structuredClone({ slot: state.slot, created: state.created });
		const tx = {
			addExpense() {
				draft.created.push(EXPENSE_ID);
			},
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => ({
							for: async () =>
								draft.slot ? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }] : [],
						}),
					}),
				}),
			}),
			insert: (table: unknown) => ({
				values: (value: Record<string, unknown>) => ({
					returning: async () => {
						if (table !== recurringExpenses) throw new Error('unexpected insert');
						draft.created.push(EXPENSE_ID);
						return [
							{
								...value,
								id: EXPENSE_ID,
								createdAt: new Date(),
								lastCreatedAt: null,
								pausedAt: null,
							},
						];
					},
				}),
			}),
			update: (table: unknown) => ({
				set: (values: { responseBody: unknown; expiresAt: Date }) => ({
					where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => ({
						returning: async () => {
							if (table !== idempotencyResponses) throw new Error('unexpected update');
							state.baseWhere = dialect.sqlToQuery(condition).sql;
							if (state.failBaseWrite) throw new Error('replay_write_failed');
							if (!draft.slot || draft.slot.body._claimed !== true) return [];
							draft.slot = {
								body: JSON.parse(JSON.stringify(values.responseBody)) as Record<string, unknown>,
								expiresAt: values.expiresAt,
							};
							return [{ scope: 'claimed' }];
						},
					}),
				}),
			}),
		};
		try {
			const result = await operation(tx);
			state.slot = draft.slot;
			state.created = draft.created;
			return result;
		} finally {
			release();
		}
	};
	const db = {
		select: () => {
			const query = {
				from: () => query,
				where: () => query,
				// biome-ignore lint/suspicious/noThenProperty: Drizzle selects are thenable.
				then: (resolve: (rows: unknown[]) => unknown) =>
					Promise.resolve([{ id: MEMBER_ID }]).then(resolve),
			};
			return query;
		},
		insert: () => {
			throw new Error('business insert escaped transaction');
		},
		delete: (table: unknown) => ({
			where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => ({
				returning: async () => {
					if (table !== idempotencyResponses) throw new Error('unexpected delete');
					const [, , lease] = dialect.sqlToQuery(condition).params;
					if (
						JSON.stringify(state.slot?.body) !== '{"_claimed":true}' ||
						state.slot?.expiresAt.getTime() !== Date.parse(String(lease))
					) {
						return [];
					}
					state.slot = null;
					return [{ scope: 'released' }];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: {
				responseBody: Parameters<typeof dialect.sqlToQuery>[0];
				expiresAt?: Date;
			}) => ({
				where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => ({
					returning: async () => {
						if (table !== idempotencyResponses) throw new Error('unexpected warning update');
						state.warningSet = dialect.sqlToQuery(values.responseBody).sql;
						state.warningWhere = dialect.sqlToQuery(condition).sql;
						state.warningSetHasExpiry = values.expiresAt !== undefined;
						if (state.warningWrite === 'throw') throw new Error('warning_write_failed');
						if (state.warningWrite === 'miss' || !state.slot) return [];
						state.slot.body.warning = warning;
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
	};
	const route = kind === 'expense' ? expenseRoute : recurringRoute;
	const request = () =>
		new Request('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'idempotency-key': KEY },
			body: JSON.stringify(
				kind === 'expense'
					? {
							description: 'Einkauf',
							amountCents: 1200,
							splits: [{ debtorMemberId: MEMBER_ID, amountCents: 1200 }],
						}
					: {
							description: 'Miete',
							amountCents: 1200,
							paidByMemberId: MEMBER_ID,
							nextDueAt: new Date(Date.now() + 86_400_000).toISOString(),
							splits: [{ debtorMemberId: MEMBER_ID, amountCents: 1200 }],
						},
			),
		});
	const harness = {
		state,
		db,
		warning,
		withExpensePaymentLock,
		post: async () => {
			current = harness;
			return route.POST(
				request() as never,
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
			);
		},
	};
	return harness;
}

function harness(kind: Kind, warning: null | 'notification_delivery_failed' = null) {
	current = createHarness(kind, warning);
	return current;
}

for (const kind of ['expense', 'recurring'] as const) {
	test(`${kind} creation rolls back when durable replay write fails, then retries once`, async () => {
		const { state, post } = harness(kind);
		state.failBaseWrite = true;
		assert.equal((await post()).status, 500);
		assert.deepEqual(state.created, []);
		// The confirmed rollback frees the claim, so the same-key retry runs at once.
		assert.equal(state.slot, null);
		state.failBaseWrite = false;
		assert.equal((await post()).status, 200, state.errors.join('\n'));
		assert.deepEqual(state.created, [EXPENSE_ID]);
		assert.ok(
			((state.slot as ReplayRow | null)?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 86_400_000,
		);
		assert.match(state.baseWhere, /_claimed/);
	});

	test(`${kind} concurrent lease winners replay one committed creation`, async () => {
		const { state, post } = harness(kind);
		const responses = await Promise.all([post(), post()]);
		assert.deepEqual(
			responses.map((response) => response.status),
			[200, 200],
			state.errors.join('\n'),
		);
		assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
			state.slot?.body,
			state.slot?.body,
		]);
		assert.deepEqual(state.created, [EXPENSE_ID]);
		assert.equal(state.sideEffects, 1);
	});
}

test('expense warning update is conditional and preserves the replay expiry', async () => {
	const { state, post } = harness('expense', 'notification_delivery_failed');
	const response = await post();
	assert.equal(response.status, 200);
	assert.equal(
		((await response.json()) as { warning: unknown }).warning,
		'notification_delivery_failed',
	);
	assert.equal(state.slot?.body.warning, 'notification_delivery_failed');
	assert.match(state.warningSet, /jsonb_set/);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /expense/);
	assert.equal(state.warningSetHasExpiry, false);

	const missed = harness('expense', 'notification_delivery_failed');
	missed.state.warningWrite = 'miss';
	assert.equal(((await (await missed.post()).json()) as { warning: unknown }).warning, null);
	assert.equal(missed.state.slot?.body.warning, null);
});
