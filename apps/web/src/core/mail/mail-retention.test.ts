import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { mailLog } from '@/core/db/schema-mail-log';

const wheres: unknown[] = [];
const query = {
	select: () => query,
	from: () => query,
	where: (condition: unknown) => {
		wheres.push(condition);
		return query;
	},
	limit: () => sql`(select 1)`,
};
mock.module('@/core/db', {
	namedExports: {
		mailLog,
		db: { ...query, delete: () => ({ where: () => ({ returning: async () => [] }) }) },
	},
});
const { purgeOldMailLog } = await import('./mail-retention');

test('the purge selects invitation, reminder and account-deleted rows, never welcome rows', async () => {
	await purgeOldMailLog();
	const { params } = new PgDialect().sqlToQuery(wheres[0] as ReturnType<typeof sql>);
	assert.deepEqual(params.slice(0, 3), ['invitation', 'reminder', 'account_deleted']);
	assert.ok(!params.includes('welcome'));
});
