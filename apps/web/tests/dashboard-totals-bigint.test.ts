import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../src/core/db/schema.ts';

// sum(int4) is bigint in Postgres; an ::int cast overflows past 2^31-1 cents (about 21.4M EUR)
// and would turn the dashboard of a WG with large totals into a 500 for every member.

const totals: Array<{ sql: string; decoded: unknown }> = [];

function chain(fields?: Record<string, unknown>): unknown {
	const query = Object.assign(Promise.resolve([]), {} as Record<string, unknown>);
	for (const name of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'having', 'orderBy']) {
		query[name] = () => query;
	}
	query.limit = async () => [];
	const total = fields?.totalCents as (SQL & { mapWith?: unknown }) | undefined;
	if (total) {
		const decoder = (total as unknown as { decoder: { mapFromDriverValue(v: unknown): unknown } })
			.decoder;
		totals.push({
			sql: new PgDialect().sqlToQuery(total).sql,
			decoded: decoder.mapFromDriverValue('2200000000'),
		});
	}
	return query;
}

mock.module('@/core/db', {
	namedExports: { ...schema, db: { select: (fields?: Record<string, unknown>) => chain(fields) } },
});

const { loadPrimaryRows } = await import('../src/composition/dashboard-queries.ts');

test('dashboard expense aggregates stay bigint and decode to numbers', async () => {
	await loadPrimaryRows('wg-1', new Date('2026-10-01T00:00:00Z'));
	assert.equal(totals.length, 2);
	for (const total of totals) {
		assert.doesNotMatch(total.sql, /::int/);
		assert.equal(total.decoded, 2_200_000_000);
	}
});
