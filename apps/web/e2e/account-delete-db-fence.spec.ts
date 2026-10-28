// Account deletion against a disposable loopback PostgreSQL (own config: account-delete-db.config.cjs): durable fence and credential revocation.
// Why: deletion must be atomic, fenced and leave no residue; only a real database proves FK/cascade behaviour.

import { expect, test } from '@playwright/test';
import {
	accountDeleteTestUrl,
	deferred,
	registerAccountDeleteDatabase,
	trackDeletionFixture,
	waitForBlockedQuery,
} from './support/account-delete-db-helpers';
import { tuple } from './support/helpers';

registerAccountDeleteDatabase();

test('account deletion keeps a durable fence and revokes only the departing member credentials', async () => {
	process.env.POSTGRES_URL = accountDeleteTestUrl;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';

	const { Pool } = await import('pg');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { calendarSubscriptions, pushSubscriptions, wgMembers, wgs } = await import(
		'../src/core/db/schema'
	);
	const { eq } = await import('drizzle-orm');

	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const otherUser = crypto.randomUUID();
	const ids = await withTransaction(async (tx) => {
		const [wg] = tuple(
			await tx
				.insert(wgs)
				.values({
					shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(),
					name: 'Credential fence',
				})
				.returning({ id: wgs.id }),
			1,
		);
		const [departing, other] = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: wg.id, name: 'Departing', role: 'admin', authUserId: user, pushOptIn: true },
					{ wgId: wg.id, name: 'Staying', role: 'member', authUserId: otherUser, pushOptIn: true },
				])
				.returning({ id: wgMembers.id }),
			2,
		);
		await tx.insert(calendarSubscriptions).values([
			{ wgId: wg.id, memberId: departing.id, tokenSeed: crypto.randomUUID() },
			{ wgId: wg.id, memberId: other.id, tokenSeed: crypto.randomUUID() },
		]);
		await tx.insert(pushSubscriptions).values([
			{
				memberId: departing.id,
				endpoint: `https://push.example/${crypto.randomUUID()}`,
				p256dh: 'test-key',
				authKey: 'test-key',
			},
			{
				memberId: other.id,
				endpoint: `https://push.example/${crypto.randomUUID()}`,
				p256dh: 'test-key',
				authKey: 'test-key',
			},
		]);
		return { wgId: wg.id, departingId: departing.id, otherId: other.id };
	});

	await withTransaction((tx) => removeAccountFromWgs(tx, user));

	const pool = new Pool({ connectionString: accountDeleteTestUrl });
	try {
		const { rows: deletions } = await pool.query(
			' SELECT auth_user_id, requested_at, completed_at FROM account_deletions WHERE auth_user_id = $1',
			[user],
		);
		expect(deletions).toHaveLength(1);
		expect(deletions[0]).toMatchObject({ auth_user_id: user, completed_at: null });
		expect(deletions[0].requested_at).toBeTruthy();

		const { rows: calendars } = await pool.query(
			' SELECT member_id FROM calendar_subscriptions WHERE wg_id = $1 ORDER BY member_id',
			[ids.wgId],
		);
		expect(calendars.map((row) => row.member_id)).toEqual([ids.otherId]);
		const { rows: pushes } = await pool.query(
			' SELECT member_id FROM push_subscriptions WHERE member_id IN ($1, $2) ORDER BY member_id',
			[ids.departingId, ids.otherId],
		);
		expect(pushes.map((row) => row.member_id)).toEqual([ids.otherId]);
	} finally {
		await pool.end();
	}

	await withTransaction(async (tx) => {
		const members = await tx
			.select({
				id: wgMembers.id,
				authUserId: wgMembers.authUserId,
				pushOptIn: wgMembers.pushOptIn,
			})
			.from(wgMembers)
			.where(eq(wgMembers.wgId, ids.wgId));
		expect(members.find((member) => member.id === ids.departingId)).toMatchObject({
			authUserId: null,
			pushOptIn: false,
		});
		expect(members.find((member) => member.id === ids.otherId)?.authUserId).toBe(otherUser);
	});
});

test('account deletion fence is private to anonymous and authenticated Data API roles', async () => {
	const { Client } = await import('pg');
	const client = new Client({ connectionString: accountDeleteTestUrl });
	await client.connect();
	try {
		const { rows: roles } = await client.query(
			"SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
		);
		if (roles.length !== 2)
			test.skip(true, 'Requires anon and authenticated roles in disposable database.');
		const { rows } = await client.query(`
			SELECT c.relrowsecurity AS rls,
				has_table_privilege('anon', 'public.account_deletions', 'SELECT') AS anon_select,
				has_table_privilege('anon', 'public.account_deletions', 'INSERT') AS anon_insert,
				has_table_privilege('anon', 'public.account_deletions', 'UPDATE') AS anon_update,
				has_table_privilege('anon', 'public.account_deletions', 'DELETE') AS anon_delete,
				has_table_privilege('authenticated', 'public.account_deletions', 'SELECT') AS authenticated_select,
				has_table_privilege('authenticated', 'public.account_deletions', 'INSERT') AS authenticated_insert,
				has_table_privilege('authenticated', 'public.account_deletions', 'UPDATE') AS authenticated_update,
				has_table_privilege('authenticated', 'public.account_deletions', 'DELETE') AS authenticated_delete
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relname = 'account_deletions'
		`);
		expect(rows).toEqual([
			{
				rls: true,
				anon_select: false,
				anon_insert: false,
				anon_update: false,
				anon_delete: false,
				authenticated_select: false,
				authenticated_insert: false,
				authenticated_update: false,
				authenticated_delete: false,
			},
		]);
	} finally {
		await client.end();
	}
});

test('a fresh deletion status read waits for the account fence transaction', async () => {
	process.env.POSTGRES_URL = accountDeleteTestUrl;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { accountDeletions } = await import('../src/core/db/schema');
	const { lockAccount, readAccountDeletionStatusWithFreshConnection } = await import(
		'../src/core/db/account-deletion'
	);
	const { withTransaction } = await import('../src/core/db/transaction');
	const { sql } = await import('drizzle-orm');
	const authUserId = crypto.randomUUID();
	trackDeletionFixture(authUserId);
	const observer = new Client({ connectionString: accountDeleteTestUrl });
	await observer.connect();
	const deletionReady = deferred();
	const releaseDeletion = deferred();
	const deletion = withTransaction(async (tx) => {
		await tx.execute(
			sql`select set_config('application_name', ${`fence-${crypto.randomUUID()}`}, true)`,
		);
		await lockAccount(tx, authUserId);
		await tx.insert(accountDeletions).values({ authUserId });
		deletionReady.resolve();
		await releaseDeletion.promise;
	});
	let status: Awaited<ReturnType<typeof readAccountDeletionStatusWithFreshConnection>> | undefined;
	let statusError: unknown;
	let statusRead: Promise<void> | undefined;
	let statusReadBlocked = false;
	try {
		await deletionReady.promise;
		statusRead = readAccountDeletionStatusWithFreshConnection(authUserId).then(
			(value) => {
				status = value;
			},
			(error: unknown) => {
				statusError = error;
			},
		);
		statusReadBlocked = await waitForBlockedQuery(observer, 'manawg-account-deletion-status-check');
	} finally {
		releaseDeletion.resolve();
		try {
			await deletion;
			await statusRead;
		} finally {
			await observer.end();
		}
	}
	expect(statusReadBlocked).toBe(true);
	expect(statusError).toBeUndefined();
	expect(status).toEqual({ completedAt: null });
});

test('a committed deletion fence blocks a stale authenticated membership acquisition', async () => {
	process.env.POSTGRES_URL = accountDeleteTestUrl;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { accountDeletions } = await import('../src/core/db/schema');
	const { assertAccountCanAcquireMembership, lockAccount } = await import(
		'../src/core/db/account-deletion'
	);
	const { withTransaction } = await import('../src/core/db/transaction');
	const { sql } = await import('drizzle-orm');
	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const deletionApp = `delete-${crypto.randomUUID()}`;
	const acquireApp = `acquire-${crypto.randomUUID()}`;
	const observer = new Client({ connectionString: accountDeleteTestUrl });
	await observer.connect();
	const deletionReady = deferred();
	const releaseDeletion = deferred();
	const deletion = withTransaction(async (tx) => {
		await tx.execute(sql`select set_config('application_name', ${deletionApp}, true)`);
		await lockAccount(tx, user);
		await tx.insert(accountDeletions).values({ authUserId: user });
		deletionReady.resolve();
		await releaseDeletion.promise;
	});
	let acquisition: Promise<{ allowed: true } | { allowed: false; error: unknown }> | undefined;
	try {
		await deletionReady.promise;
		const acquisitionStarted = deferred();
		acquisition = withTransaction(async (tx) => {
			await tx.execute(sql`select set_config('application_name', ${acquireApp}, true)`);
			acquisitionStarted.resolve();
			await assertAccountCanAcquireMembership(tx, user);
		}).then(
			() => ({ allowed: true as const }),
			(error: unknown) => ({ allowed: false as const, error }),
		);
		await acquisitionStarted.promise;
		expect(await waitForBlockedQuery(observer, acquireApp)).toBe(true);
	} finally {
		releaseDeletion.resolve();
		try {
			await deletion;
		} finally {
			await observer.end();
		}
	}
	expect(acquisition).toBeDefined();
	if (!acquisition) return;
	expect(await acquisition).toMatchObject({
		allowed: false,
		error: { name: 'TransactionAbort', code: 'account_deletion_pending' },
	});
});
