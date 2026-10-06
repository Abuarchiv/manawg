import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { ParsedExpense } from '../import-parsers';

const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const bobId = '44444444-4444-4444-8444-444444444444';
const charlieId = '55555555-5555-4555-8555-555555555555';
const expenses = {
	wgId: 'expenses.wgId',
	paidByMemberId: 'expenses.paidByMemberId',
	description: 'expenses.description',
	amountCents: 'expenses.amountCents',
	currency: 'expenses.currency',
	occurredAt: 'expenses.occurredAt',
	importDuplicateKey: 'expenses.importDuplicateKey',
};
const expenseImports = { id: 'expenseImports.id' };
const expenseSplits = {};
const wgMembers = { id: 'wgMembers.id' };

type Row = Record<string, unknown>;

/** The database stand-in of the commit currently under test. */
const current = {
	existingExpenses: [] as Row[],
	mapping: { Alice: memberId } as Record<string, string>,
	inserted: [] as Row[],
	splits: [] as unknown[],
};

const tx = {
	select(fields: Record<string, unknown>) {
		let table: unknown;
		const query = {
			from(selectedTable: unknown) {
				table = selectedTable;
				return query;
			},
			where: async () => {
				assert.equal(table, expenses);
				const knownFields: unknown[] = Object.values(expenses);
				return current.existingExpenses.map((row) =>
					Object.fromEntries(
						Object.entries(fields).map(([key, field]) => [
							key,
							knownFields.includes(field) ? row[key] : undefined,
						]),
					),
				);
			},
		};
		return query;
	},
	insert(table: unknown) {
		return {
			values(value: Row | unknown[]) {
				if (table === expenseImports) {
					return { returning: async () => [{ id: 'import-1' }] };
				}
				if (table === expenses) {
					const insert = {
						onConflictDoNothing: () => insert,
						returning: async () => {
							const row = { ...value, id: `expense-${current.inserted.length + 1}` };
							current.inserted.push(row);
							return [{ id: row.id }];
						},
					};
					return insert;
				}
				assert.equal(table, expenseSplits);
				assert.ok(Array.isArray(value));
				current.splits.push(...value);
				return Promise.resolve();
			},
		};
	},
	update(table: unknown) {
		assert.equal(table, expenseImports);
		return { set: () => ({ where: async () => [] }) };
	},
};

const { TransactionAbort } = await import('@/core/db/transaction-abort');

mock.module('@/core/activity-feed', { namedExports: { postSystemNotice: async () => {} } });
mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => {} } });
mock.module('@/core/db', {
	namedExports: {
		db: {
			select: () => ({
				from: (table: unknown) => {
					assert.equal(table, wgMembers);
					return {
						where: async () => Object.values(current.mapping).map((id) => ({ id })),
					};
				},
			}),
		},
		expenseImports,
		expenseSplits,
		expenses,
		wgMembers,
	},
});
// These commits carry no replay key, so the claim protocol must stay untouched.
mock.module('@/core/db/claimed-response', {
	namedExports: {
		lockClaimedResponse: () => assert.fail('a commit without a replay key claimed a slot'),
		completeClaimedResponse: () => assert.fail('a commit without a replay key completed a slot'),
		releaseLockedClaim: () => assert.fail('a commit without a replay key released a slot'),
		releaseClaimedResponse: () => assert.fail('a commit without a replay key released a slot'),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: () => assert.fail('a commit without a replay key claimed a slot'),
		getCachedResponse: () => assert.fail('a commit without a replay key read a stored response'),
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: () => assert.fail('a commit without a replay key claimed a slot'),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction: () => assert.fail('an import must run inside the expense payment lock'),
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		hasCapturingExpensePayment: async () => false,
		withExpensePaymentLock: async (_id: string, operation: (client: typeof tx) => unknown) =>
			operation(tx),
	},
});
mock.module('@/features/expenses/split-math', {
	namedExports: { settledAtForOwnShare: () => null },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (field: unknown, value: unknown) => ({ field, value }),
		inArray: (field: unknown, values: unknown) => ({ field, values }),
		isNull: (field: unknown) => ({ field, isNull: true }),
		sql: (parts: unknown, ...values: unknown[]) => ({ parts, values }),
	},
});

const { commitImport } = await import('./import-commit');

const dinner: ParsedExpense = {
	date: '2025-01-15',
	description: 'Dinner',
	amountCents: 1200,
	currency: 'EUR',
	paidByName: 'Alice',
	splits: [{ memberName: 'Alice', amountCents: 1200 }],
	warnings: [],
};

function runCommit(
	existingExpenses: Row[],
	{
		rows = [dinner],
		mapping = { Alice: memberId },
		mayRecordForOthers = false,
	}: {
		rows?: ParsedExpense[];
		mapping?: Record<string, string>;
		mayRecordForOthers?: boolean;
	} = {},
) {
	current.existingExpenses = existingExpenses;
	current.mapping = mapping;
	current.inserted = [];
	current.splits = [];
	const input = {
		wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
		source: 'manual',
		importedByMemberId: memberId,
		importedByName: 'Alice',
		mayRecordForOthers,
		expenses: rows.map((parsed) => ({ skip: false, parsed })),
		mapping,
		skipDuplicates: true,
		rawPayloadHash: 'payload-hash',
	} as const;
	return commitImport({ scope: 'import-commit', key: null }, async () => ({ input })).then(
		(outcome) => {
			if (outcome.kind === 'stopped') assert.fail('a commit without a stop reason was stopped');
			return outcome.result;
		},
	);
}

test('duplicate checks distinguish currencies and keep the legacy EUR import key', async () => {
	const existing = (currency: string) => ({
		wgId,
		paidByMemberId: memberId,
		description: 'Dinner',
		amountCents: 1200,
		currency,
		occurredAt: new Date('2025-01-15T12:00:00.000Z'),
	});

	const inserted = await runCommit([existing('USD')]);
	assert.deepEqual([inserted.inserted, inserted.skipped], [1, 0]);
	assert.equal(
		current.inserted[0]?.importDuplicateKey,
		'2025-01-15|dinner|1200|33333333-3333-4333-8333-333333333333',
	);

	const skipped = await runCommit([existing('EUR')]);
	assert.deepEqual([skipped.inserted, skipped.skipped], [0, 1]);
});

const foreignRow: ParsedExpense = {
	date: '2025-02-01',
	description: 'Strom',
	amountCents: 5000,
	currency: 'EUR',
	paidByName: 'Bob',
	splits: [{ memberName: 'Charlie', amountCents: 5000 }],
	warnings: [],
};
const threeMembers = { Alice: memberId, Bob: bobId, Charlie: charlieId };

test('a regular member cannot import a debt between two other members', async () => {
	const result = await runCommit([], { rows: [foreignRow], mapping: threeMembers });
	assert.equal(result.inserted, 0);
	assert.deepEqual(result.errors, [{ index: 0, reason: 'paid_by_must_include_caller' }]);
	assert.equal(current.inserted.length, 0);
});

test('a WG admin may import a shared history that includes other members', async () => {
	const result = await runCommit([], {
		rows: [foreignRow],
		mapping: threeMembers,
		mayRecordForOthers: true,
	});
	assert.equal(result.inserted, 1);
	assert.deepEqual(result.errors, []);
});
