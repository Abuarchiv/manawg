import { expect, test } from '@playwright/test';

// Runs against a throwaway Postgres with the repo migrations applied:
// ACCOUNT_DELETE_TEST_URL=postgresql://postgres@127.0.0.1:55432/manawg_test
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
	const flatmate = crypto.randomUUID();
	const code = () => crypto.randomUUID().slice(0, 8).toUpperCase();

	const ids = await withTransaction(async (tx) => {
		const [shared, solo] = await tx
			.insert(wgs)
			.values([
				{ shareCode: code(), name: 'Shared' },
				{ shareCode: code(), name: 'Solo' },
			])
			.returning({ id: wgs.id });
		const [me, guest, mate] = await tx
			.insert(wgMembers)
			.values([
				{ wgId: shared.id, name: 'Me', role: 'admin', authUserId: user },
				{ wgId: shared.id, name: 'Guest', role: 'member' },
				{ wgId: shared.id, name: 'Mate', role: 'member', authUserId: flatmate },
			])
			.returning({ id: wgMembers.id });
		const [soloMe] = await tx
			.insert(wgMembers)
			.values({ wgId: solo.id, name: 'Me', role: 'admin', authUserId: user })
			.returning({ id: wgMembers.id });
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
	const otherUser = crypto.randomUUID();
	const ids = await withTransaction(async (tx) => {
		const [wg] = await tx
			.insert(wgs)
			.values({ shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(), name: 'Credential fence' })
			.returning({ id: wgs.id });
		const [departing, other] = await tx
			.insert(wgMembers)
			.values([
				{ wgId: wg.id, name: 'Departing', role: 'admin', authUserId: user, pushOptIn: true },
				{ wgId: wg.id, name: 'Staying', role: 'member', authUserId: otherUser, pushOptIn: true },
			])
			.returning({ id: wgMembers.id });
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
			.select({ id: wgMembers.id, authUserId: wgMembers.authUserId, pushOptIn: wgMembers.pushOptIn })
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
		if (roles.length !== 2) test.skip(true, 'Requires anon and authenticated roles in disposable database.');
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
