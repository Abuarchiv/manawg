// Account deletion against a disposable loopback PostgreSQL (own config: account-delete-db.config.cjs): failure atomicity and retries.
// Why: deletion must be atomic, fenced and leave no residue; only a real database proves FK/cascade behaviour.

import { expect, test } from '@playwright/test';
import {
	accountDeleteTestUrl,
	registerAccountDeleteDatabase,
	trackDeletionFixture,
} from './support/account-delete-db-helpers';
import { tuple } from './support/helpers';

registerAccountDeleteDatabase();

test('a failed local deletion transaction leaves no fence, cleanup, audit, or Auth attempt', async () => {
	process.env.POSTGRES_URL = accountDeleteTestUrl;
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
	process.env.POSTGRES_URL = accountDeleteTestUrl;
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
	const pool = new Pool({ connectionString: accountDeleteTestUrl });
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
	process.env.POSTGRES_URL = accountDeleteTestUrl;
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
