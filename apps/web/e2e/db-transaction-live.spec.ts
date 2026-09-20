import { expect, test } from '@playwright/test';

test('Preview transactions use runtime credentials and roll back writes', async () => {
	const runtimeUrl = process.env.PREVIEW_TRANSACTION_TEST_URL;
	if (!runtimeUrl) {
		test.skip(true, 'Requires explicit isolated Preview database credentials.');
		return;
	}
	const project = process.env.PREVIEW_TRANSACTION_PROJECT_REF;
	expect(project).toMatch(/^[a-z]{20}$/);
	expect(new URL(runtimeUrl).hostname).toBe(`db.${project}.supabase.co`);
	const keys = [
		'POSTGRES_URL',
		'DATABASE_MIGRATION_URL',
		'POSTGRES_URL_NON_POOLING',
		'DATABASE_URL_UNPOOLED',
	] as const;
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
	try {
		process.env.POSTGRES_URL = runtimeUrl;
		process.env.DATABASE_MIGRATION_URL = 'placeholder';
		Reflect.deleteProperty(process.env, 'POSTGRES_URL_NON_POOLING');
		Reflect.deleteProperty(process.env, 'DATABASE_URL_UNPOOLED');
		const { withTransaction } = await import('../src/core/db/transaction');
		const { sql } = await import('drizzle-orm');
		const rollback = new Error('intentional release-check rollback');
		let backendPid: unknown;
		await expect(
			withTransaction(async (tx) => {
				await tx.execute(sql`create temporary table manawg_release_transaction_probe (id integer)`);
				await tx.execute(sql`insert into manawg_release_transaction_probe values (1)`);
				const result = await tx.execute(
					sql`select count(*)::integer as count from manawg_release_transaction_probe`,
				);
				expect(result.rows[0]?.count).toBe(1);
				backendPid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
				throw rollback;
			}),
		).rejects.toBe(rollback);
		const result = await withTransaction((tx) =>
			tx.execute(
				sql`select pg_backend_pid() as pid, to_regclass('pg_temp.manawg_release_transaction_probe') is null as rolled_back`,
			),
		);
		expect(result.rows[0]?.rolled_back).toBe(true);
		expect(typeof backendPid).toBe('number');
		expect(result.rows[0]?.pid).toBe(backendPid);
	} finally {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	}
});
