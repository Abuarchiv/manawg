import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { loopbackClient, SUPABASE_STUB } from '../../scripts/test-db-setup.mjs';

// Populated upgrade rehearsal for 0045_member_onboarding_email: a database on the schema before
// 0045 with real WG memberships is upgraded through the production entry point
// (scripts/db-migrate.mjs), then migrated again. The clean-database setup never sees existing
// rows, so this is the only check that an upgrade keeps them and gives them the intended value.
// Opt-in (`pnpm test:db-upgrade`): UPGRADE_TEST_DATABASE_URL names a loopback PostgreSQL server
// whose user may create databases; the test creates and drops its own database there.
const serverUrl = process.env.UPGRADE_TEST_DATABASE_URL;
const skip = serverUrl ? false : 'UPGRADE_TEST_DATABASE_URL is not set';

const TARGET = '0045_member_onboarding_email';
const webDir = path.resolve(import.meta.dirname, '../..');
const drizzleDir = path.join(webDir, 'drizzle');
const run = promisify(execFile);

const dbName = `manawg_upgrade_${randomUUID().replaceAll('-', '')}`;
let dbUrl = '';
let admin: pg.Client;
let client: pg.Client;
let prefixDir = '';

// Complete records, so a change to any existing column shows up. The upgrade comparison leaves
// out only the column 0045 adds; the rerun comparison includes it.
const WG_ROWS = 'select to_jsonb(w) as row from public.wgs as w order by id';
const MEMBER_ROWS = 'select to_jsonb(m) as row from public.wg_members as m order by id';
const MEMBER_ROWS_BEFORE_0045 = `select to_jsonb(m) - 'notify_onboarding_email' as row
	from public.wg_members as m order by id`;

async function snapshot() {
	return {
		wgs: (await client.query(WG_ROWS)).rows,
		members: (await client.query(MEMBER_ROWS)).rows,
	};
}

/** The production migrator CLI, exactly as `pnpm db:migrate` runs it on a self-hosted stack. */
async function migrateEntryPoint() {
	const { stderr } = await run(process.execPath, ['scripts/db-migrate.mjs'], {
		cwd: webDir,
		env: {
			PATH: process.env.PATH,
			NODE_ENV: 'test',
			MANAWG_SELF_HOSTED: 'true',
			DATABASE_MIGRATION_URL: dbUrl,
		},
	});
	return stderr;
}

async function ledgerCount() {
	const { rows } = await client.query(
		'select count(*)::int as count from drizzle.__drizzle_migrations',
	);
	return rows[0].count as number;
}

before(async () => {
	if (!serverUrl) return;
	admin = loopbackClient(serverUrl);
	await admin.connect();
	await admin.query(`create database ${dbName}`);
	const url = new URL(serverUrl);
	url.pathname = `/${dbName}`;
	dbUrl = url.toString();
	client = loopbackClient(dbUrl);
	await client.connect();
	await client.query(SUPABASE_STUB);

	// The schema before 0045: the same migration files and ledger, with the journal cut before it.
	const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8'));
	const cut = journal.entries.findIndex((entry: { tag: string }) => entry.tag === TARGET);
	assert.ok(cut > 0, `${TARGET} must be in the journal`);
	prefixDir = mkdtempSync(path.join(tmpdir(), 'manawg-upgrade-'));
	mkdirSync(path.join(prefixDir, 'meta'));
	for (const { tag } of journal.entries.slice(0, cut)) {
		cpSync(path.join(drizzleDir, `${tag}.sql`), path.join(prefixDir, `${tag}.sql`));
	}
	writeFileSync(
		path.join(prefixDir, 'meta', '_journal.json'),
		JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
	);
	await migrate(drizzle(client), { migrationsFolder: prefixDir });
	assert.equal(await ledgerCount(), cut);

	// Two WGs with admins, members, a deactivated member and one without an account.
	const wgs = [randomUUID(), randomUUID()];
	for (const [index, id] of wgs.entries()) {
		await client.query('insert into public.wgs (id, share_code, name) values ($1, $2, $3)', [
			id,
			`UPG${index}`,
			`Upgrade WG ${index}`,
		]);
	}
	// Settings vary per member (and differ from the defaults), so overwriting any column is visible.
	const members = [
		[wgs[0], randomUUID(), 'Ada', 'admin', 'de', '#e11d48', true, 22, 7, null],
		[wgs[0], randomUUID(), 'Ben', 'member', 'en', null, false, null, null, null],
		[wgs[0], null, 'Cleo', 'member', 'es', '#2563eb', true, 23, 6, null],
		[wgs[1], randomUUID(), 'Dana', 'admin', 'en', null, false, 21, 8, null],
		[
			wgs[1],
			randomUUID(),
			'Emil',
			'member',
			'de',
			'#16a34a',
			true,
			null,
			null,
			'2026-11-01T10:00Z',
		],
	];
	for (const [index, member] of members.entries()) {
		const [wgId, userId, name, role, locale, color, flag, quietStart, quietEnd, deactivatedAt] =
			member;
		const odd = index % 2 === 1;
		await client.query(
			`insert into public.wg_members
				(wg_id, auth_user_id, name, role, locale, color, push_opt_in,
				 notify_announcements, notify_chores, notify_expenses, notify_shopping,
				 notify_inventory, notify_reminders, notify_chat, notify_events,
				 notify_statement_email, quiet_start_hour, quiet_end_hour, deactivated_at,
				 created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
				$18, $19, $20)`,
			[
				wgId,
				userId,
				name,
				role,
				locale,
				color,
				flag,
				!flag,
				odd,
				!odd,
				flag,
				odd,
				!flag,
				!odd,
				flag,
				!flag,
				quietStart,
				quietEnd,
				deactivatedAt,
				`2026-10-0${index + 1}T12:00Z`,
			],
		);
	}
	await client.query(
		"update public.wgs set updated_at = '2026-10-15T09:30Z', created_at = '2026-09-01T08:00Z'",
	);
});

after(async () => {
	await client?.end();
	if (admin) {
		await admin.query(`drop database if exists ${dbName} with (force)`);
		await admin.end();
	}
	if (prefixDir) rmSync(prefixDir, { recursive: true, force: true });
});

test(`upgrading a populated database through ${TARGET} keeps every membership`, {
	skip,
}, async () => {
	const wgsBefore = (await client.query(WG_ROWS)).rows;
	const membersBefore = (await client.query(MEMBER_ROWS)).rows;
	assert.equal(wgsBefore.length, 2);
	assert.equal(membersBefore.length, 5);
	const { rows: column } = await client.query(
		`select 1 from information_schema.columns
		 where table_schema = 'public' and table_name = 'wg_members' and column_name = 'notify_onboarding_email'`,
	);
	assert.equal(column.length, 0, 'the seeded schema must predate the onboarding column');

	assert.match(await migrateEntryPoint(), /\[migrate\] Up to date\./);

	assert.deepEqual((await client.query(WG_ROWS)).rows, wgsBefore);
	assert.deepEqual((await client.query(MEMBER_ROWS_BEFORE_0045)).rows, membersBefore);

	const { rows: definition } = await client.query(
		`select is_nullable, column_default from information_schema.columns
		 where table_schema = 'public' and table_name = 'wg_members' and column_name = 'notify_onboarding_email'`,
	);
	assert.deepEqual(definition, [{ is_nullable: 'NO', column_default: 'true' }]);
	const { rows: existing } = await client.query(
		'select notify_onboarding_email from public.wg_members',
	);
	assert.deepEqual(
		existing.map((row) => row.notify_onboarding_email),
		[true, true, true, true, true],
	);

	const { rows: fresh } = await client.query(
		`insert into public.wg_members (wg_id, name)
		 select id, 'Fynn' from public.wgs order by name limit 1
		 returning notify_onboarding_email`,
	);
	assert.equal(fresh[0].notify_onboarding_email, true);
	await assert.rejects(
		client.query(
			`insert into public.wg_members (wg_id, name, notify_onboarding_email)
			 select id, 'Gus', null from public.wgs limit 1`,
		),
		/null value in column "notify_onboarding_email"/,
	);
});

test('migrating the upgraded database again changes nothing', { skip }, async () => {
	const upgraded = await snapshot();
	assert.ok(upgraded.members.every(({ row }) => row.notify_onboarding_email === true));
	const applied = await ledgerCount();

	assert.match(await migrateEntryPoint(), /\[migrate\] Verified up to date\./);

	assert.deepEqual(await snapshot(), upgraded);
	assert.equal(await ledgerCount(), applied);
});
