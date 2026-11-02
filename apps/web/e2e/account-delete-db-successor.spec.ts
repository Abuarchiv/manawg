// Account deletion against a disposable loopback PostgreSQL (own config: account-delete-db.config.cjs): choice of the successor admin.
// Why: a WG whose remaining members cannot act as admin must be deleted, not left without anyone to run it.

import { expect, test } from '@playwright/test';
import {
	accountDeleteTestUrl,
	registerAccountDeleteDatabase,
	trackDeletionFixture,
} from './support/account-delete-db-helpers';
import { tuple } from './support/helpers';

registerAccountDeleteDatabase();

test('account deletion picks the longest-standing linked active member and ignores leavers and placeholders', async () => {
	process.env.POSTGRES_URL = accountDeleteTestUrl;
	process.env.DATABASE_MIGRATION_URL = 'placeholder';
	const { withTransaction } = await import('../src/core/db/transaction');
	const { removeAccountFromWgs } = await import('../src/core/db/delete-account');
	const { wgMembers, wgs } = await import('../src/core/db/schema');
	const { inArray } = await import('drizzle-orm');

	const user = crypto.randomUUID();
	trackDeletionFixture(user);
	const code = () => crypto.randomUUID().slice(0, 8).toUpperCase();
	const at = (day: number) => new Date(Date.UTC(2026, 0, day));

	const ids = await withTransaction(async (tx) => {
		const [kept, orphaned, placeholderOnly] = tuple(
			await tx
				.insert(wgs)
				.values([
					{ shareCode: code(), name: 'Kept' },
					{ shareCode: code(), name: 'Only a leaver' },
					{ shareCode: code(), name: 'Only a placeholder' },
				])
				.returning({ id: wgs.id }),
			3,
		);
		const rows = tuple(
			await tx
				.insert(wgMembers)
				.values([
					{ wgId: kept.id, name: 'Me', role: 'admin', authUserId: user, createdAt: at(1) },
					// Older than the successor, but moved out / without a login: neither can act as admin.
					{
						wgId: kept.id,
						name: 'Left',
						authUserId: crypto.randomUUID(),
						deactivatedAt: at(5),
						createdAt: at(2),
					},
					{ wgId: kept.id, name: 'Placeholder', createdAt: at(3) },
					{ wgId: kept.id, name: 'Late', authUserId: crypto.randomUUID(), createdAt: at(20) },
					{ wgId: kept.id, name: 'Early', authUserId: crypto.randomUUID(), createdAt: at(10) },
					{ wgId: orphaned.id, name: 'Me', role: 'admin', authUserId: user, createdAt: at(1) },
					{
						wgId: orphaned.id,
						name: 'Left',
						authUserId: crypto.randomUUID(),
						deactivatedAt: at(5),
						createdAt: at(2),
					},
					{ wgId: placeholderOnly.id, name: 'Me', role: 'admin', authUserId: user },
					{ wgId: placeholderOnly.id, name: 'Placeholder', createdAt: at(3) },
				])
				.returning({ id: wgMembers.id, name: wgMembers.name }),
			9,
		);
		const early = rows.find((row) => row.name === 'Early');
		const late = rows.find((row) => row.name === 'Late');
		if (!early || !late) throw new Error('fixture');
		return {
			kept: kept.id,
			orphaned: orphaned.id,
			placeholderOnly: placeholderOnly.id,
			early: early.id,
			late: late.id,
		};
	});

	const result = await withTransaction((tx) => removeAccountFromWgs(tx, user));
	// A WG whose only other members left or have no login has nobody to run it: it goes with the account.
	expect([...result.deletedWgIds].sort()).toEqual([ids.orphaned, ids.placeholderOnly].sort());
	expect(result.left.map((row) => row.newAdminId)).toEqual([ids.early]);

	await withTransaction(async (tx) => {
		const roles = await tx
			.select({ id: wgMembers.id, role: wgMembers.role })
			.from(wgMembers)
			.where(inArray(wgMembers.id, [ids.early, ids.late]));
		expect(Object.fromEntries(roles.map((row) => [row.id, row.role]))).toEqual({
			[ids.early]: 'admin',
			[ids.late]: 'member',
		});
		const remaining = await tx
			.select({ id: wgs.id })
			.from(wgs)
			.where(inArray(wgs.id, [ids.kept, ids.orphaned, ids.placeholderOnly]));
		expect(remaining.map((row) => row.id)).toEqual([ids.kept]);
	});
});
