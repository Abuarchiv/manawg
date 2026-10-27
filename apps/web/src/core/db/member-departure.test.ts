import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseMemberChores } from '@/core/db/member-departure';
import { memberAbsences } from '@/core/db/schema';
import type { DbTransaction } from '@/core/db/transaction';
import { PgDialect } from 'drizzle-orm/pg-core';

test('releaseMemberChores drops the leaving member’s ongoing and future absences only', async () => {
	const deletes: Array<{ table: unknown; sql: string; params: unknown[] }> = [];
	const tx = {
		update: () => ({ set: () => ({ where: async () => {} }) }),
		delete: (table: unknown) => ({
			where: async (condition: Parameters<PgDialect['sqlToQuery']>[0]) => {
				const query = new PgDialect().sqlToQuery(condition);
				deletes.push({ table, sql: query.sql, params: query.params });
			},
		}),
	} as unknown as DbTransaction;

	await releaseMemberChores(tx, 'wg-1', 'member-1');

	assert.equal(deletes.length, 1);
	assert.equal(deletes[0]?.table, memberAbsences);
	assert.match(deletes[0]?.sql ?? '', /"member_id" = \$2 and .*"end_date" >= \$3/);
	assert.deepEqual(deletes[0]?.params.slice(0, 2), ['wg-1', 'member-1']);
});
