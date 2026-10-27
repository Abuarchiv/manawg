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
	// A settled promise with the builder methods on it, so `await query` and `.catch` work.
	const query = Object.assign(Promise.resolve([]), {} as Record<string, unknown>);
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
		const orderBy = columns.map((column) => new PgDialect().sqlToQuery(column).sql).join(', ');
		if (table === schema.expenses) expenseQueries.push({ where, orderBy });
		return query;
	};
	query.limit = async () => [];
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
