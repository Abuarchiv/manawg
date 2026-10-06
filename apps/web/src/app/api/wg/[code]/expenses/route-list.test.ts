import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mockDb } from '../../../../../../tests/support/db-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';

const wgId = '11111111-1111-4111-8111-111111111111';
const firstMemberId = '33333333-3333-4333-8333-333333333333';
const secondMemberId = '44444444-4444-4444-8444-444444444444';

const expenses = pgTable('expenses', {
	id: uuid('id'),
	wgId: uuid('wg_id'),
	amountCents: integer('amount_cents'),
	occurredAt: timestamp('occurred_at', { withTimezone: true }),
});
const expenseSplits = pgTable('expense_splits', {
	id: uuid('id'),
	expenseId: uuid('expense_id'),
	debtorMemberId: uuid('debtor_member_id'),
	amountCents: integer('amount_cents'),
	settledAt: timestamp('settled_at', { withTimezone: true }),
});

interface SplitQuery {
	columns: Record<string, unknown>;
	joined: unknown;
	predicate: unknown;
}

const state = {
	rows: [] as Record<string, unknown>[],
	splitRows: [] as Record<string, unknown>[],
	splitQueries: [] as SplitQuery[],
};

function given(expenseCount: number): void {
	state.rows = Array.from({ length: expenseCount }, (_, index) => ({
		id: `expense-${index}`,
		wgId,
		amountCents: 100,
		occurredAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
	}));
	state.splitRows = state.rows.map((row) => ({
		id: `split-${row.id}`,
		expenseId: row.id,
		debtorMemberId: secondMemberId,
		amountCents: 100,
		settledAt: null,
	}));
	state.splitQueries = [];
	rateLimit.calls = [];
}

mockObservability();
const rateLimit = mockRateLimit();
mockWgMember({
	wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId: firstMemberId, name: 'First' },
});
mockDb({
	expenseSplits,
	expenses,
	db: {
		select: (columns: Record<string, unknown>) => {
			let table: unknown = null;
			let joined: unknown = null;
			const query = {
				from(selected: unknown) {
					table = selected;
					return query;
				},
				innerJoin(selected: unknown) {
					joined = selected;
					return query;
				},
				where(predicate: unknown) {
					if (table === expenseSplits) {
						state.splitQueries.push({ columns, joined, predicate });
						return Promise.resolve(state.splitRows);
					}
					assert.equal(table, expenses);
					return query;
				},
				orderBy: async () => state.rows,
			};
			return query;
		},
	},
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: {
		loadCompletedExpensePayments: async () => [],
		hasCapturingExpensePayment: async () => false,
		withExpensePaymentLock: () => assert.fail('listing expenses takes no payment lock'),
	},
});

const { GET } = await import('./route');

const get = () => GET(request('/api/wg/MTE8PZAT/expenses'), routeCtx());

test('expense list is throttled per member before touching the database', async () => {
	given(1);
	rateLimit.limited.add('expensesReadLimiter');
	try {
		const response = await get();
		assert.equal(response.status, 429);
		assert.deepEqual(rateLimit.calls, [
			['expensesReadLimiter', `expenses:${wgId}:${firstMemberId}`],
		]);
		assert.equal(state.splitQueries.length, 0);
	} finally {
		rateLimit.limited.clear();
	}
});

test('expense list loads splits for more than 65,535 expenses without a bind parameter per id', async () => {
	given(70_000);
	const response = await get();
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.expenses.length, 70_000);
	assert.ok(
		(body.expenses as { splits: unknown[] }[]).every((expense) => expense.splits.length === 1),
	);
	assert.equal(state.splitQueries.length, 1);
	const [query] = state.splitQueries;
	assert.equal(query?.joined, expenses);
	assert.deepEqual(Object.keys(query?.columns ?? {}).sort(), [
		'amountCents',
		'debtorMemberId',
		'expenseId',
		'id',
		'settledAt',
	]);
	const compiled = new PgDialect().sqlToQuery(query?.predicate as never);
	assert.deepEqual(compiled.params, [wgId]);
});
