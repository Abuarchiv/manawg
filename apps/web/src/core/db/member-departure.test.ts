import assert from 'node:assert/strict';
import test from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { lockActiveMember, releaseMemberChores } from '@/core/db/member-departure';
import { memberAbsences } from '@/core/db/schema';
import type { DbTransaction } from '@/core/db/transaction';

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

test('lockActiveMember takes a shared lock on the active member row', async () => {
	let lock: string | undefined;
	let condition: Parameters<PgDialect['sqlToQuery']>[0] | undefined;
	const rows: unknown[] = [{ id: 'member-1' }];
	const tx = {
		select: () => ({
			from: () => ({
				where: (where: typeof condition) => {
					condition = where;
					return {
						limit: () => ({
							for: async (strength: string) => {
								lock = strength;
								return rows;
							},
						}),
					};
				},
			}),
		}),
	} as unknown as DbTransaction;

	assert.equal(await lockActiveMember(tx, 'wg-1', 'member-1'), true);
	assert.equal(lock, 'share');
	const query = new PgDialect().sqlToQuery(condition as NonNullable<typeof condition>);
	assert.match(query.sql, /"deactivated_at" is null/);
	assert.deepEqual(query.params, ['member-1', 'wg-1']);

	rows.length = 0;
	assert.equal(await lockActiveMember(tx, 'wg-1', 'member-1'), false);
});
