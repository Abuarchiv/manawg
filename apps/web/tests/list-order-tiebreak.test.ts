import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import type { Expense } from '../src/features/expenses/expense-types.ts';
import { sortExpensesNewestFirst } from '../src/features/expenses/optimistic-expense.ts';

// Rows that share a due date or a day keep one order across reloads and edits: the lists break
// ties by creation time and id instead of leaving them to the database's scan order.

const schema = await import('../src/core/db/schema.ts');
const orderings: Record<string, string> = {};

function chain(): unknown {
	let table: unknown;
	const query = Object.assign(Promise.resolve([]), {} as Record<string, unknown>);
	query.from = (next: unknown) => {
		table = next;
		return query;
	};
	query.where = () => query;
	query.orderBy = (...columns: SQL[]) => {
		const sql = columns.map((column) => new PgDialect().sqlToQuery(column).sql).join(', ');
		if (table === schema.chores) orderings.chores = sql;
		if (table === schema.expenses) orderings.expenses = sql;
		return query;
	};
	return query;
}

mock.module('@/core/db', { namedExports: { ...schema, db: { select: () => chain() } } });
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort, withTransaction: async () => assert.fail('no tx') },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg-1', shareCode: 'MTE8PZAT', name: 'WG' },
			member: { memberId: 'member-1', name: 'Mina' },
		}),
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
	namedExports: { loadCompletedExpensePayments: async () => [], withExpensePaymentLock: undefined },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const request = new Request('http://localhost/api') as never;
const ctx = { params: Promise.resolve({ code: 'MTE8PZAT' }) } as never;

test('the chore list orders equal due dates by creation time and id', async () => {
	const { GET } = await import('../src/app/api/wg/[code]/chores/route.ts');
	await GET(request, ctx);
	assert.match(orderings.chores ?? '', /"next_due_at" asc, .*"created_at" asc, .*"id" asc/);
});

test('the expense list orders equal days by creation time and id', async () => {
	const { GET } = await import('../src/app/api/wg/[code]/expenses/route.ts');
	await GET(request, ctx);
	assert.match(orderings.expenses ?? '', /"occurred_at" desc, .*"created_at" desc, .*"id" desc/);
});

function expense(id: string, occurredAt: string, createdAt: string): Expense {
	return { id, occurredAt, createdAt } as Expense;
}

test('the optimistic expense order matches the server tie-break', () => {
	const day = '2026-10-01T12:00:00.000Z';
	const sorted = sortExpensesNewestFirst([
		expense('a', day, '2026-10-01T08:00:00.000Z'),
		expense('c', day, '2026-10-01T09:00:00.000Z'),
		expense('b', day, '2026-10-01T09:00:00.000Z'),
		expense('z', '2026-09-30T12:00:00.000Z', '2026-10-02T09:00:00.000Z'),
	]);
	assert.deepEqual(
		sorted.map((entry) => entry.id),
		['c', 'b', 'a', 'z'],
	);
});
