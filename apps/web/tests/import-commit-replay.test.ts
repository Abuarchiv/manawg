// Import commit replay: a retried import never double-books expenses, a lost response replays the
// one committed import, and malformed or missing claims fail closed before writing.
// The real claim protocol, idempotent write and commitImport run against an in-memory claim row
// and a payment lock that serializes concurrent commits.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mockModuleWithReal } from './support/module-mocks';

type CommitResult = {
	importId: string;
	inserted: number;
	skipped: number;
	errors: Array<{ index: number; reason: string }>;
	warning: null | 'notification_delivery_failed' | 'notification_delivery_unknown';
};

const expenseImports = { id: 'expense-import-id' };
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'response-body',
	expiresAt: 'expires-at',
};

interface HarnessState {
	slot: unknown;
	claimExpiresAt: Date;
	imports: number;
	notices: number;
	audits: number;
	dispatches: number;
	capturing: boolean;
	failReplayWrite: boolean;
}

/** The claim row, counters and payment lock of the harness under test. */
let current: {
	state: HarnessState;
	withExpensePaymentLock: (wgId: string, operation: (tx: unknown) => Promise<unknown>) => unknown;
} | null = null;
const active = () => {
	if (!current) throw new Error('no import harness is active');
	return current;
};

await mockModuleWithReal('@/core/activity-feed', {
	postSystemNotice: async () => active().state.notices++,
});
await mockModuleWithReal('@/core/audit', { recordAuditEvent: async () => active().state.audits++ });
await mockModuleWithReal('@/core/db', {
	db: {},
	expenseImports,
	expenseSplits: {},
	expenses: {},
	idempotencyResponses,
	wgMembers: {},
});
// Commits carry a claimed replay slot, so the store's claim and read report "won, nothing stored".
await mockModuleWithReal('@/core/idempotency-store', {
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
});
await mockModuleWithReal('@/core/notifications/notification-dispatch', {
	dispatchNotificationSafely: async () => {
		active().state.dispatches += 1;
		return { warning: 'notification_delivery_failed' };
	},
});
await mockModuleWithReal('@/core/infra/observability', { logApiError: () => undefined });
await mockModuleWithReal('@/core/utils/money', { formatEuroCents: () => '0,00 €' });
await mockModuleWithReal('@/features/expenses/server/expense-payments', {
	hasCapturingExpensePayment: async () => active().state.capturing,
	withExpensePaymentLock: (wgId: string, operation: (tx: unknown) => Promise<unknown>) =>
		active().withExpensePaymentLock(wgId, operation),
});
await mockModuleWithReal('@/features/expenses/split-math', { settledAtForOwnShare: () => null });
await mockModuleWithReal('@/features/expenses/paid-by-guard', {
	checkPaidByGuard: () => ({ ok: true }),
});
await mockModuleWithReal('drizzle-orm', {
	and: (...parts: unknown[]) => parts,
	eq: (...parts: unknown[]) => parts,
	inArray: (...parts: unknown[]) => parts,
	isNull: (part: unknown) => part,
	sql: () => null,
});

const { commitImport: commitImportModule } = await import(
	'../src/features/expenses/server/import-commit'
);

describe('import replay atomic', () => {
	function harness(initialSlot: unknown) {
		const state = {
			slot: initialSlot,
			claimExpiresAt: new Date(Date.now() + 15 * 60_000),
			imports: 0,
			notices: 0,
			audits: 0,
			dispatches: 0,
			capturing: false,
			failReplayWrite: false,
		};
		let prior = Promise.resolve();
		const withExpensePaymentLock = async (
			_wgId: string,
			operation: (tx: unknown) => Promise<unknown>,
		) => {
			const waitFor = prior;
			let release: () => void = () => undefined;
			prior = new Promise<void>((resolve) => {
				release = resolve;
			});
			await waitFor;
			let slotDraft = state.slot;
			let importsDraft = 0;
			const tx = {
				select: () => ({
					from: () => ({
						where: () => ({
							limit: () => ({
								for: async () =>
									slotDraft === undefined
										? []
										: [{ body: slotDraft, expiresAt: state.claimExpiresAt }],
							}),
						}),
					}),
				}),
				insert: (table: unknown) => ({
					values: () => ({
						returning: async () => {
							if (table !== expenseImports) throw new Error('unexpected insert');
							importsDraft += 1;
							return [{ id: 'import-1' }];
						},
					}),
				}),
				update: (table: unknown) => ({
					set: (value: { responseBody?: unknown }) => ({
						where: () => ({
							returning: async () => {
								if (table !== idempotencyResponses) throw new Error('unexpected replay update');
								if (state.failReplayWrite) throw new Error('cache_write_failed');
								slotDraft = value.responseBody;
								return [{ scope: 'import-commit:wg:member' }];
							},
						}),
					}),
				}),
			};
			try {
				const result = await operation(tx);
				state.slot = slotDraft;
				state.imports += importsDraft;
				return result;
			} finally {
				release();
			}
		};
		current = { state, withExpensePaymentLock };
		const commitImport = async ({ replay, ...body }: ReturnType<typeof input>) =>
			(
				(await commitImportModule(replay, async () => ({ input: body }) as never)) as {
					result: CommitResult;
				}
			).result;
		return { state, commitImport };
	}

	function input(count = 1, skip = true) {
		return {
			wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
			source: 'splitwise_csv',
			importedByMemberId: 'member',
			importedByName: 'Member',
			expenses: Array.from({ length: count }, () => ({
				parsed: {
					date: '2026-09-01T00:00:00.000Z',
					description: 'Expense',
					amountCents: 100,
					currency: 'EUR',
					paidByName: 'Unknown',
					splits: [],
					warnings: [],
				},
				skip,
			})),
			mapping: {},
			skipDuplicates: false,
			rawPayloadHash: 'hash',
			replay: { scope: 'import-commit:wg:member', key: 'key' },
		};
	}

	test('import waits for PayPal capture without writing an expense', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		state.capturing = true;
		await assert.rejects(commitImport(input()), /paypal_payment_pending/);
		assert.equal(state.imports, 0);
		assert.deepEqual(state.slot, { _claimed: true });
	});

	test('lost response and notification failure replay the one committed import', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const first = await commitImport(input());
		const replay = await commitImport(input());
		assert.equal(first.warning, 'notification_delivery_failed');
		assert.deepEqual(replay, { ...first, warning: null });
		assert.equal(state.imports, 1);
		assert.deepEqual([state.notices, state.audits, state.dispatches], [1, 1, 1]);
	});

	test('a concurrent retry after claim lease reclaim inserts only once', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const results = await Promise.all([commitImport(input()), commitImport(input())]);
		assert.equal(results[0]?.importId, results[1]?.importId);
		assert.equal(state.imports, 1);
		assert.equal(state.dispatches, 1);
	});

	test('failed replay write rolls back import and allows a safe retry', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		state.failReplayWrite = true;
		await assert.rejects(commitImport(input()), /cache_write_failed/);
		assert.equal(state.imports, 0);
		assert.deepEqual(state.slot, { _claimed: true });
		state.failReplayWrite = false;
		await commitImport(input());
		assert.equal(state.imports, 1);
	});

	test('claim cleanup before the transaction fails closed', async () => {
		const { state, commitImport } = harness(undefined);
		await assert.rejects(commitImport(input()), /idempotency_claim_missing/);
		assert.equal(state.imports, 0);
	});

	test('null, malformed, and unavailable claims fail closed before writing', async () => {
		for (const slot of [null, { _replayUnavailable: true }, {}, { _claimed: true, extra: 1 }]) {
			const { state, commitImport } = harness(slot);
			await assert.rejects(commitImport(input()), /idempotency_claim_(missing|invalid)/);
			assert.equal(state.imports, 0);
		}
	});

	test('a large replay result remains available without a post-commit cache update', async () => {
		const { state, commitImport } = harness({ _claimed: true });
		const body = input(1_500, false);
		const first = await commitImport(body);
		assert.ok(JSON.stringify(first).length > 32 * 1024);
		assert.deepEqual(await commitImport(body), { ...first, warning: null });
		assert.equal(state.imports, 1);
	});
});
