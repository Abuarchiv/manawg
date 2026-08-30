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

	beforeAll(async () => {
		await client.connect();
		await client.query('create role anon nologin').catch(() => undefined);
		await client.query('create role authenticated nologin').catch(() => undefined);
		await client.query('grant usage on schema public to anon, authenticated');
		await client.query(
			'grant select, update on all tables in schema public to public, anon, authenticated',
		);
		await client.query(migrationSql);
	});

	afterAll(async () => {
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
});
