import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const migrationSql = readFileSync(
	resolve(process.cwd(), 'drizzle/0007_data_api_security.sql'),
	'utf8',
);

describe.skipIf(!databaseUrl)('Data API table privileges (real database)', () => {
	const client = new Client({ connectionString: databaseUrl });
	const existingFunction = 'public.manawg_data_api_existing_test()';
	const futureFunction = 'public.manawg_data_api_future_test()';
	const futureTable = 'public.manawg_data_api_future_test';

	beforeAll(async () => {
		await client.connect();
		await client.query('create role anon nologin').catch(() => undefined);
		await client.query('create role authenticated nologin').catch(() => undefined);
		await client.query('grant usage on schema public to anon, authenticated');
		await client.query(`drop function if exists ${existingFunction}`);
		await client.query(`drop function if exists ${futureFunction}`);
		await client.query(`drop table if exists ${futureTable}`);
		await client.query(
			'alter default privileges in schema public grant select, update on tables to public, anon, authenticated',
		);
		await client.query(
			'alter default privileges in schema public grant execute on functions to public, anon, authenticated',
		);
		await client.query(
			`create function ${existingFunction} returns integer language sql as 'select 1'`,
		);
		await client.query(
			`grant execute on function ${existingFunction} to public, anon, authenticated`,
		);
		await client.query(
			'grant select, update on all tables in schema public to public, anon, authenticated',
		);
		await client.query(migrationSql);
		await client.query(`create table ${futureTable} (id integer primary key)`);
		await client.query(
			`create function ${futureFunction} returns integer language sql as 'select 1'`,
		);
	});

	afterAll(async () => {
		await client.query(`drop table if exists ${futureTable}`);
		await client.query(`drop function if exists ${existingFunction}`);
		await client.query(`drop function if exists ${futureFunction}`);
		await client.end();
	});

	it('denies anon and authenticated roles direct reads and writes to internal tables', async () => {
		const { rows } = await client.query<{
			role: string;
			canSelect: boolean;
			canUpdate: boolean;
		}>(`
			select role, has_table_privilege(role, 'public.wg_members', 'select') as "canSelect",
				has_table_privilege(role, 'public.wg_members', 'update') as "canUpdate"
			from unnest(array['anon', 'authenticated']) as role
		`);

		expect(rows).toEqual([
			{ role: 'anon', canSelect: false, canUpdate: false },
			{ role: 'authenticated', canSelect: false, canUpdate: false },
		]);
	});

	it('revokes execute from existing and future functions, including seeded defaults', async () => {
		const { rows } = await client.query<{
			role: string;
			canExecuteExisting: boolean;
			canExecuteFuture: boolean;
		}>(`
			select role,
				has_function_privilege(role, '${existingFunction}', 'execute') as "canExecuteExisting",
				has_function_privilege(role, '${futureFunction}', 'execute') as "canExecuteFuture"
			from unnest(array['anon', 'authenticated']) as role
		`);

		expect(rows).toEqual([
			{ role: 'anon', canExecuteExisting: false, canExecuteFuture: false },
			{ role: 'authenticated', canExecuteExisting: false, canExecuteFuture: false },
		]);
	});

	it('removes seeded table defaults from objects created after the migration', async () => {
		const { rows } = await client.query<{
			role: string;
			canSelect: boolean;
			canUpdate: boolean;
		}>(`
			select role, has_table_privilege(role, '${futureTable}', 'select') as "canSelect",
				has_table_privilege(role, '${futureTable}', 'update') as "canUpdate"
			from unnest(array['anon', 'authenticated']) as role
		`);

		expect(rows).toEqual([
			{ role: 'anon', canSelect: false, canUpdate: false },
			{ role: 'authenticated', canSelect: false, canUpdate: false },
		]);
	});
});
