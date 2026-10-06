// Creating an expense or recurring template with a replay key: the business row and the durable
// replay response commit together, a failed replay write rolls both back and frees the claim, and
// concurrent lease winners replay the one committed creation.
// The fake transaction renders the claim-completion and warning statements with PgDialect: the
// claim guard and the conditional warning update are conditions of those statements, so the tests
// check that they reach the database.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { idempotencyResponses, recurringExpenses } from '../src/core/db/schema';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const MEMBER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const EXPENSE_ID = '550e8400-e29b-41d4-a716-446655440000';
const SPLIT_ID = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
const KEY = 'retry-key';

type Kind = 'expense' | 'recurring';
type ReplayRow = { body: Record<string, unknown>; expiresAt: Date };
type HarnessState = ReturnType<typeof harness>['state'];

/** Database, payment lock and outcome of the harness under test. */
let current: {
	state: HarnessState;
	db: Record<string, unknown>;
	withExpensePaymentLock: (wgId: string, operation: (tx: unknown) => Promise<unknown>) => unknown;
	warning: null | 'notification_delivery_failed';
} | null = null;
const active = () => {
	if (!current) throw new Error('no replay harness is active');
	return current;
};

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID, shareCode: 'MTE8PZAT', name: 'WG' },
		member: { memberId: MEMBER_ID, name: 'Mina' },
	}),
	logApiError: (message, err) => {
		active().state.errors.push(`${message}: ${String(err)}`);
	},
	recordAuditEvent: async () => {
		active().state.sideEffects += 1;
	},
	// Like the real wrapper, an uncaught error becomes a 500.
	withWgRoute:
		(label: string, handler: (req: Request, ctx: unknown) => Promise<Response>) =>
		async (req: Request, ctx: unknown) => {
			try {
				return await handler(req, ctx);
			} catch (err) {
				active().state.errors.push(`[${label}]: ${String(err)}`);
				return Response.json({ error: 'server_error' }, { status: 500 });
			}
		},
});
await mockModuleWithReal('@/core/db', {
	db: new Proxy({}, { get: (_target, property) => active().db[property as string] }),
});
// The warning write is the real store's statement against the fake database above.
const realStore = (await import(
	new URL('../src/core/idempotency-store.ts?replay-harness', import.meta.url).href
)) as typeof import('../src/core/idempotency-store');
await mockModuleWithReal('@/core/idempotency-store', {
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
	readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
	setReplayWarning: realStore.setReplayWarning,
});
await mockModuleWithReal('@/core/db/private-image-deletions', {
	assertPrivateImageCanBeAttached: async () => undefined,
});
await mockModuleWithReal('@/core/guards/admin', { requireOwnerOrAdmin: async () => null });
await mockModuleWithReal('@/core/guards/replay-slot', {
	claimReplaySlot: async () => {
		const { state } = active();
		state.slot ??= { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
		return { won: true };
	},
});
await mockModuleWithReal('@/core/guards/route-preamble', {
	readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
});
await mockModuleWithReal('@/core/validators/currency', { currencySchema: z.string() });
await mockModuleWithReal('@/core/validators/image-url', {
	imageUrlSchema: z.string().nullable().optional(),
	isAllowedImageUrlForWg: () => true,
});
await mockModuleWithReal('@/features/expenses/server/expense-payments', {
	hasCapturingExpensePayment: async () => false,
	withExpensePaymentLock: (wgId: string, operation: (tx: unknown) => Promise<unknown>) =>
		active().withExpensePaymentLock(wgId, operation),
});
await mockModuleWithReal('@/features/expenses/paid-by-guard', {
	checkPaidByGuard: () => ({ ok: true }),
});
await mockModuleWithReal('@/features/expenses/server/expenses', {
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
		active().state.sideEffects += 1;
		return active().warning;
	},
	resolveExpensePayer: (_payer: unknown, caller: string) => caller,
});
await mockModuleWithReal('@/features/expenses/recurring-expenses', {
	parseRecurringSplits: JSON.parse,
	serializeRecurringExpense: (row: { splitsJson: string }) => ({
		...row,
		splits: JSON.parse(row.splitsJson),
	}),
});

const routes = {
	expense: await import('../src/app/api/wg/[code]/expenses/route'),
	recurring: await import('../src/app/api/wg/[code]/recurring-expenses/route'),
};

function harness(kind: Kind, warning: null | 'notification_delivery_failed' = null) {
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
	current = { state, db, withExpensePaymentLock, warning };
	const request = () =>
		new NextRequest('http://localhost', {
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
	const post = async () =>
		routes[kind].POST(request(), { params: Promise.resolve({ code: 'MTE8PZAT' }) });
	return { state, post };
}

describe('expense create replay atomic', () => {
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
			// The assertion above narrowed the slot; the retry has written it again since.
			const slot = state.slot as ReplayRow | null;
			assert.ok((slot?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 86_400_000);
			assert.ok(state.baseWhere.includes('_claimed'));
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
		assert.equal((await response.json()).warning, 'notification_delivery_failed');
		assert.equal(state.slot?.body.warning, 'notification_delivery_failed');
		assert.ok(state.warningSet.includes('jsonb_set'));
		assert.ok(state.warningWhere.includes('expires_at'));
		assert.ok(state.warningWhere.includes('expense'));
		assert.equal(state.warningSetHasExpiry, false);

		const missed = harness('expense', 'notification_delivery_failed');
		missed.state.warningWrite = 'miss';
		assert.equal((await (await missed.post()).json()).warning, null);
		assert.equal(missed.state.slot?.body.warning, null);
	});
});
