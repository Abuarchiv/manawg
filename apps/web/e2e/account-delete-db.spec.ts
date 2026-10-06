// Account deletion against a disposable loopback PostgreSQL with the repo migrations applied
// (own config: account-delete-db.config.cjs), e.g.
// ACCOUNT_DELETE_TEST_URL=postgresql://postgres@127.0.0.1:55432/manawg_test
// Deletion must hand over, fence and clean up atomically, and a failed or partial run must resume;
// only a real database proves the FK and cascade behaviour.

import { expect, test } from '@playwright/test';
import { tuple } from './_helpers';
import { trackDeletionFixture, useAccountDeleteDatabase } from './support/account-delete-db';

useAccountDeleteDatabase();

test('account deletion hands over admin, moves out, and deletes solo WGs', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at a disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { withTransaction } = await import('../src/core/db/transaction');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { expenses, wgMembers, wgs } = await import('../src/core/db/schema');
	const { eq, inArray } = await import('drizzle-orm');

	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const flatmate = crypto.randomUUID();
	const code = () => crypto.randomUUID().slice(0, 8).toUpperCase();

	const ids = await withTransaction(async (tx) => {
		const [shared, solo] = tuple(
			await tx
				.insert(wgs)
				.values([
					{ shareCode: code(), name: 'Shared' },
					{ shareCode: code(), name: 'Solo' },
				])
				.returning({ id: wgs.id }),
			2,
		);
		const [me, guest, mate] = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: shared.id, name: 'Me', role: 'admin', authUserId: user },
					{ wgId: shared.id, name: 'Guest', role: 'member' },
					{ wgId: shared.id, name: 'Mate', role: 'member', authUserId: flatmate },
				])
				.returning({ id: wgMembers.id }),
			3,
		);
		const [soloMe] = tuple(
			await tx
				.insert(wgMembers)
				.values({ wgId: solo.id, name: 'Me', role: 'admin', authUserId: user })
				.returning({ id: wgMembers.id }),
			1,
		);
		await tx.insert(expenses).values([
			{ wgId: shared.id, paidByMemberId: me.id, amountCents: 1000, description: 'Kept' },
			{ wgId: solo.id, paidByMemberId: soloMe.id, amountCents: 500, description: 'Gone' },
		]);
		return { shared: shared.id, solo: solo.id, me: me.id, guest: guest.id, mate: mate.id };
	});

	const result = await withTransaction((tx) => removeAccountFromWgs(tx, user));
	expect(result.deletedWgIds).toEqual([ids.solo]);
	expect(result.left).toEqual([
		{ wgId: ids.shared, memberId: ids.me, name: 'Me', newAdminId: ids.mate },
	]);

	await withTransaction(async (tx) => {
		const members = await tx
			.select()
			.from(wgMembers)
			.where(inArray(wgMembers.wgId, [ids.shared, ids.solo]));
		const byId = new Map(members.map((m) => [m.id, m]));
		expect(byId.get(ids.me)).toMatchObject({ authUserId: null, role: 'member' });
		expect(byId.get(ids.me)?.deactivatedAt).not.toBeNull();
		expect(byId.get(ids.mate)?.role).toBe('admin');
		expect(byId.get(ids.guest)?.role).toBe('member');
		expect(members.filter((m) => m.wgId === ids.solo)).toHaveLength(0);
		expect(await tx.select().from(wgs).where(eq(wgs.id, ids.solo))).toHaveLength(0);
		expect(await tx.select().from(expenses).where(eq(expenses.wgId, ids.shared))).toHaveLength(1);
	});

	// A retry after a failed auth-provider call finds nothing left to detach.
	expect(await withTransaction((tx) => removeAccountFromWgs(tx, user))).toEqual({
		left: [],
		deletedWgIds: [],
	});
});

test('account deletion keeps a durable fence and revokes only the departing member credentials', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
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

	const pool = new Pool({ connectionString: url });
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
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	const { Client } = await import('pg');
	const client = new Client({ connectionString: url });
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

test('a failed local deletion transaction leaves no fence, cleanup, audit, or Auth attempt', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { withTransaction } = await import('../src/core/db/transaction');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { tryCompleteAccountDeletion } = await import('../src/core/db/account-deletion');
	const {
		accountDeletions,
		auditEvents,
		calendarSubscriptions,
		pushSubscriptions,
		wgMembers,
		wgs,
	} = await import('../src/core/db/schema');
	const { and, eq } = await import('drizzle-orm');
	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const otherUser = crypto.randomUUID();
	const ids = await withTransaction(async (tx) => {
		const [wg] = tuple(
			await tx
				.insert(wgs)
				.values({ shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(), name: 'Rollback' })
				.returning({ id: wgs.id }),
			1,
		);
		const [departing, staying] = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: wg.id, name: 'Departing', role: 'admin', authUserId: user, pushOptIn: true },
					{ wgId: wg.id, name: 'Staying', role: 'member', authUserId: otherUser },
				])
				.returning({ id: wgMembers.id }),
			2,
		);
		await tx.insert(calendarSubscriptions).values({
			wgId: wg.id,
			memberId: departing.id,
			tokenSeed: crypto.randomUUID(),
		});
		await tx.insert(pushSubscriptions).values({
			memberId: departing.id,
			endpoint: `https://push.example/${crypto.randomUUID()}`,
			p256dh: 'test-key',
			authKey: 'test-key',
		});
		return { wgId: wg.id, memberId: departing.id, stayingId: staying.id };
	});

	await expect(
		withTransaction(async (tx) => {
			const removed = await removeAccountFromWgs(tx, user);
			for (const { wgId, memberId, name, newAdminId } of removed.left) {
				await tx.insert(auditEvents).values({
					wgId,
					memberId,
					eventType: 'member.account_deletion_requested',
					entityType: 'member',
					entityId: memberId,
					summary: `${name} hat die Kontolöschung angefragt und ist ausgezogen.`,
					metadataJson: JSON.stringify({ name, newAdminId }),
				});
			}
			throw new Error('injected rollback');
		}),
	).rejects.toThrow('injected rollback');

	let authCalled = false;
	expect(
		await tryCompleteAccountDeletion(user, async () => {
			authCalled = true;
			return true;
		}),
	).toBe(false);
	expect(authCalled).toBe(false);
	await withTransaction(async (tx) => {
		expect(
			await tx
				.select({ authUserId: accountDeletions.authUserId })
				.from(accountDeletions)
				.where(eq(accountDeletions.authUserId, user)),
		).toHaveLength(0);
		expect(
			await tx
				.select({
					id: wgMembers.id,
					authUserId: wgMembers.authUserId,
					deactivatedAt: wgMembers.deactivatedAt,
				})
				.from(wgMembers)
				.where(eq(wgMembers.id, ids.memberId)),
		).toMatchObject([{ authUserId: user, deactivatedAt: null }]);
		expect(
			await tx
				.select({ id: calendarSubscriptions.id })
				.from(calendarSubscriptions)
				.where(eq(calendarSubscriptions.memberId, ids.memberId)),
		).toHaveLength(1);
		expect(
			await tx
				.select({ id: pushSubscriptions.id })
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.memberId, ids.memberId)),
		).toHaveLength(1);
		expect(
			await tx
				.select({ id: auditEvents.id })
				.from(auditEvents)
				.where(
					and(
						eq(auditEvents.wgId, ids.wgId),
						eq(auditEvents.eventType, 'member.account_deletion_requested'),
					),
				),
		).toHaveLength(0);
		expect(await tx.select().from(wgMembers).where(eq(wgMembers.id, ids.stayingId))).toHaveLength(
			1,
		);
	});
});

test('Auth success is not marked complete when the completion write fails, and retries resume', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Pool } = await import('pg');
	const { accountDeletions } = await import('../src/core/db/schema');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { tryCompleteAccountDeletion } = await import('../src/core/db/account-deletion');
	const { eq } = await import('drizzle-orm');
	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
	const functionName = `manawg_test_fail_completion_${suffix}`;
	const triggerName = `manawg_test_fail_completion_${suffix}`;
	const pool = new Pool({ connectionString: url });
	await withTransaction((tx) => tx.insert(accountDeletions).values({ authUserId: user }));
	try {
		await pool.query(`
			CREATE FUNCTION public."${functionName}"() RETURNS trigger
			LANGUAGE plpgsql AS $$
			BEGIN
				IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL THEN
					RAISE EXCEPTION 'injected completion recording failure';
				END IF;
				RETURN NEW;
			END
			$$
		`);
		await pool.query(
			`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF completed_at ON public.account_deletions FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`,
		);
		let authCalls = 0;
		expect(
			await tryCompleteAccountDeletion(user, async () => {
				authCalls += 1;
				return true;
			}),
		).toBe(false);
		expect(authCalls).toBe(1);
		const [stillPending] = await withTransaction((tx) =>
			tx
				.select({
					lastAttemptAt: accountDeletions.lastAttemptAt,
					completedAt: accountDeletions.completedAt,
				})
				.from(accountDeletions)
				.where(eq(accountDeletions.authUserId, user))
				.limit(1),
		);
		expect(stillPending?.lastAttemptAt).toBeInstanceOf(Date);
		expect(stillPending?.completedAt).toBeNull();
	} finally {
		await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.account_deletions`);
		await pool.query(`DROP FUNCTION IF EXISTS public."${functionName}"()`);
	}

	expect(await tryCompleteAccountDeletion(user, async () => false)).toBe(false);
	expect(await tryCompleteAccountDeletion(user, async () => true)).toBe(true);
	let repeatedAuthCall = false;
	expect(
		await tryCompleteAccountDeletion(user, async () => {
			repeatedAuthCall = true;
			return false;
		}),
	).toBe(true);
	expect(repeatedAuthCall).toBe(false);
	await pool.end();
});

test('maintenance retries unattempted and least-recently-attempted deletions first', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { accountDeletions } = await import('../src/core/db/schema');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { retryPendingAccountDeletions } = await import('../src/core/db/account-deletion');
	const oldest = new Date(Date.now() - 3_600_000);
	const attemptedUsers = Array.from({ length: 5 }, () => crypto.randomUUID());
	const newUsers = Array.from({ length: 2 }, () => crypto.randomUUID());
	for (const user of [...attemptedUsers, ...newUsers]) trackDeletionFixture(user);
	await withTransaction((tx) =>
		tx.insert(accountDeletions).values([
			...attemptedUsers.map((authUserId, index) => ({
				authUserId,
				requestedAt: new Date(oldest.getTime() + index * 1000),
				lastAttemptAt: oldest,
			})),
			...newUsers.map((authUserId, index) => ({
				authUserId,
				requestedAt: new Date(Date.now() + index * 1000),
			})),
		]),
	);

	const firstBatch: string[] = [];
	const first = await retryPendingAccountDeletions(async (authUserId) => {
		firstBatch.push(authUserId);
		return false;
	});
	expect(first).toMatchObject({ attempted: 5, completed: 0, pending: 7 });
	expect([...firstBatch].sort()).toEqual([...newUsers, ...attemptedUsers.slice(0, 3)].sort());

	const secondBatch: string[] = [];
	const second = await retryPendingAccountDeletions(async (authUserId) => {
		secondBatch.push(authUserId);
		return false;
	});
	expect(second).toMatchObject({ attempted: 5, completed: 0, pending: 7 });
	expect(attemptedUsers.slice(3).every((user) => secondBatch.includes(user))).toBe(true);
});
