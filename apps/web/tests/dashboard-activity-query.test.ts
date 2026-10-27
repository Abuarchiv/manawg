import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../src/core/db/schema.ts';

// The Start feed lists expenses by when they were entered, so a backdated one still shows
// up as new; imported rows stay out (the import has its own feed entry).

const expenseQueries: Array<{ where: string; orderBy: string }> = [];

function chain(): unknown {
	let table: unknown;
	let where = '';
	let orderBy = '';
	const query: Record<string, unknown> = {};
	for (const name of ['innerJoin', 'leftJoin', 'groupBy', 'having']) query[name] = () => query;
	query.from = (next: unknown) => {
		table = next;
		return query;
	};
	query.where = (condition: SQL | undefined) => {
		if (condition) where = new PgDialect().sqlToQuery(condition).sql;
		return query;
	};
	query.orderBy = (...columns: SQL[]) => {
		orderBy = columns.map((column) => new PgDialect().sqlToQuery(column).sql).join(', ');
		return query;
	};
	const settle = () => {
		if (table === schema.expenses && orderBy) expenseQueries.push({ where, orderBy });
		return Promise.resolve([]);
	};
	query.limit = settle;
	query.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) =>
		settle().then(resolve, reject);
	query.catch = (reject: (err: unknown) => unknown) => settle().catch(reject);
	return query;
}

mock.module('@/core/db', {
	namedExports: { ...schema, db: { select: () => chain() } },
});

const { loadPrimaryRows } = await import('../src/composition/dashboard-queries.ts');

test('the activity preview orders expenses by entry time and leaves imports out', async () => {
	await loadPrimaryRows('wg-1', new Date('2026-10-01T00:00:00Z'));
	const activity = expenseQueries.find((query) => query.orderBy.includes('desc'));
	assert.ok(activity, 'activity expense query ran');
	assert.match(activity.orderBy, /"created_at" desc/);
	assert.match(activity.where, /"import_id" is null/);
});
