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
