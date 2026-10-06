// Account deletion under concurrency against a disposable loopback PostgreSQL (own config:
// account-delete-db.config.cjs): the deletion fence orders status reads, membership acquisitions,
// joins, departures and calendar writes against a running deletion.

import { expect, test } from '@playwright/test';
import { tuple } from './_helpers';
import {
	deferred,
	trackDeletionFixture,
	useAccountDeleteDatabase,
	waitForBlockedQuery,
} from './support/account-delete-db';

useAccountDeleteDatabase();

test('a fresh deletion status read waits for the account fence transaction', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
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
	const observer = new Client({ connectionString: url });
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
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
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
	const observer = new Client({ connectionString: url });
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

test('deletion includes a membership whose join transaction commits first', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { assertAccountCanAcquireMembership } = await import('../src/core/db/account-deletion');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { eq, sql } = await import('drizzle-orm');
	const { wgMembers, wgs } = await import('../src/core/db/schema');
	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const otherUser = crypto.randomUUID();
	const [wg, other] = await withTransaction(async (tx) => {
		const [created] = tuple(
			await tx
				.insert(wgs)
				.values({ shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(), name: 'Join race' })
				.returning({ id: wgs.id }),
			1,
		);
		const [member] = tuple(
			await tx
				.insert(wgMembers)
				.values({ wgId: created.id, name: 'Staying', role: 'admin', authUserId: otherUser })
				.returning({ id: wgMembers.id }),
			1,
		);
		return [created, member] as const;
	});
	const joinApp = `join-${crypto.randomUUID()}`;
	const deleteApp = `delete-${crypto.randomUUID()}`;
	const observer = new Client({ connectionString: url });
	await observer.connect();
	const joinReady = deferred();
	const releaseJoin = deferred();
	let joinerId = '';
	const join = withTransaction(async (tx) => {
		await tx.execute(sql`select set_config('application_name', ${joinApp}, true)`);
		await assertAccountCanAcquireMembership(tx, user);
		await tx.select({ id: wgs.id }).from(wgs).where(eq(wgs.id, wg.id)).for('update');
		const [joiner] = tuple(
			await tx
				.insert(wgMembers)
				.values({ wgId: wg.id, name: 'Joined first', role: 'member', authUserId: user })
				.returning({ id: wgMembers.id }),
			1,
		);
		joinerId = joiner.id;
		joinReady.resolve();
		await releaseJoin.promise;
	});
	let deletion: Promise<{ left: Array<{ memberId: string }>; deletedWgIds: string[] }> | undefined;
	try {
		await joinReady.promise;
		const deletionStarted = deferred();
		deletion = withTransaction(async (tx) => {
			await tx.execute(sql`select set_config('application_name', ${deleteApp}, true)`);
			deletionStarted.resolve();
			return removeAccountFromWgs(tx, user);
		});
		await deletionStarted.promise;
		expect(await waitForBlockedQuery(observer, deleteApp)).toBe(true);
	} finally {
		releaseJoin.resolve();
		try {
			await join;
		} finally {
			await observer.end();
		}
	}
	const result = await deletion;
	expect(result?.left).toHaveLength(1);
	expect(result?.deletedWgIds).toHaveLength(0);
	await withTransaction(async (tx) => {
		const members = await tx.select().from(wgMembers).where(eq(wgMembers.wgId, wg.id));
		expect(members.find((member) => member.id === joinerId)).toMatchObject({
			authUserId: null,
			role: 'member',
		});
		expect(members.find((member) => member.id === other.id)?.authUserId).toBe(otherUser);
	});
});

test('an unrelated account joining a solo WG before deletion becomes the successor admin', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { assertAccountCanAcquireMembership } = await import('../src/core/db/account-deletion');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { eq, sql } = await import('drizzle-orm');
	const { wgMembers, wgs } = await import('../src/core/db/schema');
	const deletingUser = crypto.randomUUID();
	trackDeletionFixture(deletingUser);
	const joiningUser = crypto.randomUUID();
	const [wg, departing] = await withTransaction(async (tx) => {
		const [created] = tuple(
			await tx
				.insert(wgs)
				.values({ shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(), name: 'Solo WG race' })
				.returning({ id: wgs.id }),
			1,
		);
		const [member] = tuple(
			await tx
				.insert(wgMembers)
				.values({
					wgId: created.id,
					name: 'Departing admin',
					role: 'admin',
					authUserId: deletingUser,
				})
				.returning({ id: wgMembers.id }),
			1,
		);
		return [created, member] as const;
	});
	const joinApp = `join-${crypto.randomUUID()}`;
	const deleteApp = `delete-${crypto.randomUUID()}`;
	const observer = new Client({ connectionString: url });
	await observer.connect();
	const joinReady = deferred();
	const releaseJoin = deferred();
	let joinedId = '';
	const join = withTransaction(async (tx) => {
		await tx.execute(sql`select set_config('application_name', ${joinApp}, true)`);
		await assertAccountCanAcquireMembership(tx, joiningUser);
		await tx.select({ id: wgs.id }).from(wgs).where(eq(wgs.id, wg.id)).for('update');
		const [joined] = tuple(
			await tx
				.insert(wgMembers)
				.values({ wgId: wg.id, name: 'Joining account', role: 'member', authUserId: joiningUser })
				.returning({ id: wgMembers.id }),
			1,
		);
		joinedId = joined.id;
		joinReady.resolve();
		await releaseJoin.promise;
	});
	let deletion:
		| Promise<{
				left: Array<{ memberId: string; newAdminId: string | null }>;
				deletedWgIds: string[];
		  }>
		| undefined;
	let deletionBlockedOnJoin = false;
	try {
		await joinReady.promise;
		const deletionStarted = deferred();
		deletion = withTransaction(async (tx) => {
			await tx.execute(sql`select set_config('application_name', ${deleteApp}, true)`);
			deletionStarted.resolve();
			return removeAccountFromWgs(tx, deletingUser);
		});
		await deletionStarted.promise;
		deletionBlockedOnJoin = await waitForBlockedQuery(observer, deleteApp);
	} finally {
		releaseJoin.resolve();
		try {
			await join;
		} finally {
			await observer.end();
		}
	}
	expect(deletionBlockedOnJoin).toBe(true);
	expect(deletion).toBeDefined();
	if (!deletion) return;
	const result = await deletion;
	expect(result.left).toHaveLength(1);
	expect(result.left[0]).toMatchObject({ memberId: departing.id, newAdminId: joinedId });
	expect(result.deletedWgIds).toHaveLength(0);
	await withTransaction(async (tx) => {
		const members = await tx.select().from(wgMembers).where(eq(wgMembers.wgId, wg.id));
		expect(members.find((member) => member.id === departing.id)?.deactivatedAt).toBeInstanceOf(
			Date,
		);
		expect(members.find((member) => member.id === departing.id)?.authUserId).toBeNull();
		expect(members.find((member) => member.id === joinedId)).toMatchObject({
			authUserId: joiningUser,
			role: 'admin',
			deactivatedAt: null,
		});
	});
});

test('admin deletion chooses a fallback after its pending successor moves out', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { lockActiveAccountMember } = await import('../src/core/db/account-deletion');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { eq, sql } = await import('drizzle-orm');
	const { wgMembers, wgs } = await import('../src/core/db/schema');
	const deletingUser = crypto.randomUUID();
	trackDeletionFixture(deletingUser);
	const leavingUser = crypto.randomUUID();
	const fallbackUser = crypto.randomUUID();
	const [wg, departing, pendingSuccessor, fallback] = await withTransaction(async (tx) => {
		const [created] = tuple(
			await tx
				.insert(wgs)
				.values({
					shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(),
					name: 'Successor exit race',
				})
				.returning({ id: wgs.id }),
			1,
		);
		const [admin, successor, remaining] = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: created.id, name: 'Departing admin', role: 'admin', authUserId: deletingUser },
					{
						wgId: created.id,
						name: 'Pending successor',
						role: 'member',
						authUserId: leavingUser,
						createdAt: new Date('2025-01-01T00:00:00.000Z'),
					},
					{
						wgId: created.id,
						name: 'Fallback successor',
						role: 'member',
						authUserId: fallbackUser,
						createdAt: new Date('2025-01-02T00:00:00.000Z'),
					},
				])
				.returning({ id: wgMembers.id }),
			3,
		);
		return [created, admin, successor, remaining] as const;
	});
	const leaveApp = `leave-${crypto.randomUUID()}`;
	const deleteApp = `delete-${crypto.randomUUID()}`;
	const observer = new Client({ connectionString: url });
	await observer.connect();
	const leaveReady = deferred();
	const releaseLeave = deferred();
	const leave = withTransaction(async (tx) => {
		await tx.execute(sql`select set_config('application_name', ${leaveApp}, true)`);
		const actor = await lockActiveAccountMember(tx, wg.id, pendingSuccessor.id, leavingUser);
		expect(actor).not.toBeNull();
		const [member] = await tx
			.select({ id: wgMembers.id, deactivatedAt: wgMembers.deactivatedAt })
			.from(wgMembers)
			.where(eq(wgMembers.id, pendingSuccessor.id))
			.for('update');
		expect(member?.deactivatedAt).toBeNull();
		await tx
			.update(wgMembers)
			.set({ deactivatedAt: new Date() })
			.where(eq(wgMembers.id, pendingSuccessor.id));
		leaveReady.resolve();
		await releaseLeave.promise;
	});
	let deletion:
		| Promise<{
				left: Array<{ memberId: string; newAdminId: string | null }>;
				deletedWgIds: string[];
		  }>
		| undefined;
	let deletionBlockedOnLeave = false;
	try {
		await leaveReady.promise;
		const deletionStarted = deferred();
		deletion = withTransaction(async (tx) => {
			await tx.execute(sql`select set_config('application_name', ${deleteApp}, true)`);
			deletionStarted.resolve();
			return removeAccountFromWgs(tx, deletingUser);
		});
		await deletionStarted.promise;
		deletionBlockedOnLeave = await waitForBlockedQuery(observer, deleteApp);
	} finally {
		releaseLeave.resolve();
		try {
			await leave;
		} finally {
			await observer.end();
		}
	}
	expect(deletionBlockedOnLeave).toBe(true);
	expect(deletion).toBeDefined();
	if (!deletion) return;
	const result = await deletion;
	expect(result.left).toHaveLength(1);
	expect(result.left[0]).toMatchObject({ memberId: departing.id, newAdminId: fallback.id });
	expect(result.deletedWgIds).toHaveLength(0);
	await withTransaction(async (tx) => {
		const members = await tx.select().from(wgMembers).where(eq(wgMembers.wgId, wg.id));
		expect(members.find((member) => member.id === departing.id)).toMatchObject({
			authUserId: null,
			deactivatedAt: expect.any(Date),
		});
		expect(members.find((member) => member.id === pendingSuccessor.id)).toMatchObject({
			authUserId: leavingUser,
			role: 'member',
			deactivatedAt: expect.any(Date),
		});
		expect(members.find((member) => member.id === fallback.id)).toMatchObject({
			authUserId: fallbackUser,
			role: 'admin',
			deactivatedAt: null,
		});
	});
});

test('a calendar writer waiting behind account cleanup cannot restore its credential', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { Client } = await import('pg');
	const { lockActiveAccountMember } = await import('../src/core/db/account-deletion');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { withTransaction } = await import('../src/core/db/transaction');
	const { calendarSubscriptions, wgMembers, wgs } = await import('../src/core/db/schema');
	const { eq, sql } = await import('drizzle-orm');
	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const otherUser = crypto.randomUUID();
	const ids = await withTransaction(async (tx) => {
		const [wg] = tuple(
			await tx
				.insert(wgs)
				.values({ shareCode: crypto.randomUUID().slice(0, 8).toUpperCase(), name: 'Feed race' })
				.returning({ id: wgs.id }),
			1,
		);
		const [departing] = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: wg.id, name: 'Leaving', role: 'admin', authUserId: user },
					{ wgId: wg.id, name: 'Staying', role: 'member', authUserId: otherUser },
				])
				.returning({ id: wgMembers.id }),
			1,
		);
		await tx.insert(calendarSubscriptions).values({
			wgId: wg.id,
			memberId: departing.id,
			tokenSeed: crypto.randomUUID(),
		});
		return { wgId: wg.id, departingId: departing.id };
	});
	const deleteApp = `delete-${crypto.randomUUID()}`;
	const calendarApp = `calendar-${crypto.randomUUID()}`;
	const observer = new Client({ connectionString: url });
	await observer.connect();
	const deletionReady = deferred();
	const releaseDeletion = deferred();
	const deletion = withTransaction(async (tx) => {
		await tx.execute(sql`select set_config('application_name', ${deleteApp}, true)`);
		await removeAccountFromWgs(tx, user);
		deletionReady.resolve();
		await releaseDeletion.promise;
	});
	let calendarMutation: Promise<boolean> | undefined;
	try {
		await deletionReady.promise;
		const mutationStarted = deferred();
		calendarMutation = withTransaction(async (tx) => {
			await tx.execute(sql`select set_config('application_name', ${calendarApp}, true)`);
			mutationStarted.resolve();
			const member = await lockActiveAccountMember(tx, ids.wgId, ids.departingId, user);
			if (!member) return false;
			await tx.insert(calendarSubscriptions).values({
				wgId: ids.wgId,
				memberId: member.id,
				tokenSeed: crypto.randomUUID(),
			});
			return true;
		});
		await mutationStarted.promise;
		expect(await waitForBlockedQuery(observer, calendarApp)).toBe(true);
	} finally {
		releaseDeletion.resolve();
		try {
			await deletion;
		} finally {
			await observer.end();
		}
	}
	expect(await calendarMutation).toBe(false);
	await withTransaction(async (tx) => {
		expect(
			await tx
				.select({ id: calendarSubscriptions.id })
				.from(calendarSubscriptions)
				.where(eq(calendarSubscriptions.memberId, ids.departingId)),
		).toHaveLength(0);
	});
});

test('concurrent account deletions across two shared WGs retain each remaining member and balance', async () => {
	const url = process.env.ACCOUNT_DELETE_TEST_URL;
	test.skip(!url, 'Requires ACCOUNT_DELETE_TEST_URL pointing at disposable database.');
	process.env.POSTGRES_URL = url;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { withTransaction } = await import('../src/core/db/transaction');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { expenses, wgMembers, wgs } = await import('../src/core/db/schema');
	const { eq, inArray } = await import('drizzle-orm');
	const userA = crypto.randomUUID();
	const userB = crypto.randomUUID();
	trackDeletionFixture(userA);
	trackDeletionFixture(userB);
	const code = () => crypto.randomUUID().slice(0, 8).toUpperCase();
	const fixture = await withTransaction(async (tx) => {
		const [wgA, wgB] = tuple(
			await tx
				.insert(wgs)
				.values([
					{ shareCode: code(), name: 'Shared A' },
					{ shareCode: code(), name: 'Shared B' },
				])
				.returning({ id: wgs.id }),
			2,
		);
		const createdMembers = await tx
			.insert(wgMembers)
			.values([
				{ wgId: wgA.id, name: 'A', role: 'admin', authUserId: userA },
				{ wgId: wgA.id, name: 'B', role: 'member', authUserId: userB },
				{ wgId: wgA.id, name: 'Other A', role: 'member', authUserId: crypto.randomUUID() },
				{ wgId: wgB.id, name: 'A', role: 'member', authUserId: userA },
				{ wgId: wgB.id, name: 'B', role: 'admin', authUserId: userB },
				{ wgId: wgB.id, name: 'Other B', role: 'member', authUserId: crypto.randomUUID() },
			])
			.returning({ id: wgMembers.id, name: wgMembers.name });
		const other1 = createdMembers.find((member) => member.name === 'Other A');
		const other2 = createdMembers.find((member) => member.name === 'Other B');
		if (!other1 || !other2) throw new Error('shared WG members missing');
		await tx.insert(expenses).values([
			{ wgId: wgA.id, paidByMemberId: other1.id, amountCents: 1299, description: 'Kept A' },
			{ wgId: wgB.id, paidByMemberId: other2.id, amountCents: 2599, description: 'Kept B' },
		]);
		return { wgIds: [wgA.id, wgB.id], otherIds: [other1.id, other2.id] };
	});

	const [resultA, resultB] = await Promise.all([
		withTransaction((tx) => removeAccountFromWgs(tx, userA)),
		withTransaction((tx) => removeAccountFromWgs(tx, userB)),
	]);
	expect(resultA.deletedWgIds).toEqual([]);
	expect(resultB.deletedWgIds).toEqual([]);
	await withTransaction(async (tx) => {
		const members = await tx
			.select({
				id: wgMembers.id,
				wgId: wgMembers.wgId,
				role: wgMembers.role,
				authUserId: wgMembers.authUserId,
				deactivatedAt: wgMembers.deactivatedAt,
			})
			.from(wgMembers)
			.where(inArray(wgMembers.wgId, fixture.wgIds));
		for (let index = 0; index < fixture.wgIds.length; index += 1) {
			const wgId = fixture.wgIds[index];
			const otherId = fixture.otherIds[index];
			const roster = members.filter((member) => member.wgId === wgId);
			expect(roster).toHaveLength(3);
			const activeRoster = roster.filter((member) => member.deactivatedAt === null);
			expect(activeRoster).toHaveLength(1);
			expect(activeRoster[0]?.id).toBe(otherId);
			expect(activeRoster[0]?.role).toBe('admin');
			expect(activeRoster[0]?.authUserId).toBeTruthy();
			expect(roster.filter((member) => member.role === 'admin')).toHaveLength(1);
		}
		const keptExpenses = await tx
			.select()
			.from(expenses)
			.where(inArray(expenses.wgId, fixture.wgIds));
		expect(keptExpenses.map((expense) => expense.amountCents).sort()).toEqual([1299, 2599]);
		for (const wgId of fixture.wgIds) {
			expect(await tx.select().from(wgs).where(eq(wgs.id, wgId))).toHaveLength(1);
		}
	});
});
