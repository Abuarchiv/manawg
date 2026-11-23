#!/usr/bin/env node
/**
 * Prepares a disposable loopback PostgreSQL database for `pnpm test:db` and
 * `pnpm test:e2e:account-delete-db`: the Supabase roles and the small part of the auth schema the
 * migrations and tests touch, then every migration in journal order.
 *
 *   node scripts/test-db-setup.mjs postgresql://postgres@127.0.0.1:55432/manawg_test
 *
 * Refuses anything but a loopback host, so it cannot touch a real database. The populated upgrade
 * rehearsal (`pnpm test:db-upgrade`) imports SUPABASE_STUB to prepare its own database the same way.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const SUPABASE_STUB = `
do $$ begin
	if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
	if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
	if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
	id uuid primary key,
	email text,
	raw_user_meta_data jsonb,
	raw_app_meta_data jsonb,
	encrypted_password text,
	email_confirmed_at timestamptz,
	created_at timestamptz default now(),
	deleted_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as
	$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
	$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.role() returns text language sql stable as
	$$ select current_setting('request.jwt.claim.role', true) $$;
`;

/**
 * A client for a loopback test database, or a throw. Checks the host node-postgres will actually
 * connect to: a `?host=` parameter in the URL overrides the URL's hostname.
 */
export function loopbackClient(url) {
	const client = new pg.Client({ connectionString: url });
	if (!['localhost', '127.0.0.1', '::1'].includes(client.host)) {
		throw new Error('The test database must be on a loopback host.');
	}
	return client;
}

async function setup(url) {
	let client;
	try {
		client = loopbackClient(url);
	} catch (error) {
		console.error(error.message);
		process.exit(2);
	}
	const drizzle = new URL('../drizzle/', import.meta.url);
	const { entries } = JSON.parse(readFileSync(new URL('meta/_journal.json', drizzle), 'utf8'));
	await client.connect();
	try {
		await client.query(SUPABASE_STUB);
		for (const { tag } of entries) {
			try {
				await client.query(readFileSync(new URL(`${tag}.sql`, drizzle), 'utf8'));
			} catch (error) {
				console.error(`Migration ${tag} failed: ${error.message}`);
				process.exitCode = 1;
				break;
			}
		}
		if (!process.exitCode) process.stdout.write(`Applied ${entries.length} migrations.\n`);
	} finally {
		await client.end();
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const url = process.argv[2];
	if (!url) {
		console.error('Usage: node scripts/test-db-setup.mjs <loopback PostgreSQL URL>');
		process.exit(2);
	}
	await setup(url);
}
