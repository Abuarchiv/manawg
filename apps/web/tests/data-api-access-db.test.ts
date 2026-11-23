import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';

// The Supabase advisors flag every public table as "RLS enabled, no policy". That is the intended
// access model (docs/database-access-review.md): the app reaches tables only through its own server
// connection, and the Data API roles get nothing. This pins it against a real migrated database.
// Opt-in: TEST_DATABASE_URL must name a disposable loopback database.
const url = process.env.TEST_DATABASE_URL?.trim() ?? '';
const skip = url ? false : 'TEST_DATABASE_URL is not set';
if (url) {
	assert.ok(
		['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname),
		'TEST_DATABASE_URL must be a loopback database',
	);
}

const pool = new pg.Pool({ connectionString: url || undefined, max: 1 });
after(async () => {
	await pool.end();
});

test('public tables deny the Data API roles', { skip }, async () => {
	const { rows } = await pool.query<{ table_name: string; rls: boolean; policies: number }>(
		`select rel.relname as table_name, rel.relrowsecurity as rls,
			(select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = rel.relname) as policies
		 from pg_class rel join pg_namespace ns on ns.oid = rel.relnamespace
		 where ns.nspname = 'public' and rel.relkind in ('r', 'p')
		 order by 1`,
	);
	assert.ok(rows.length >= 31, `expected the migrated schema, found ${rows.length} tables`);
	assert.deepEqual(
		rows.filter((row) => !row.rls || row.policies !== 0).map((row) => row.table_name),
		[],
	);

	const client = await pool.connect();
	try {
		for (const role of ['anon', 'authenticated']) {
			for (const { table_name } of rows) {
				for (const statement of [
					`select 1 from public.${table_name} limit 1`,
					`delete from public.${table_name}`,
				]) {
					await client.query('begin');
					await client.query(`set local role ${role}`);
					await assert.rejects(
						client.query(statement),
						(error: { code?: string }) => error.code === '42501',
						`${role} must be denied: ${statement}`,
					);
					await client.query('rollback');
				}
			}
		}
	} finally {
		await client.query('rollback').catch(() => undefined);
		client.release();
	}
});
