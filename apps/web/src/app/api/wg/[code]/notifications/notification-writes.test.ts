import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const stored = { notifyChat: true, notifyChores: false, quietStartHour: 22 as number | null };

const wgMembers = {
	id: 'id',
	wgId: 'wgId',
	notifyChat: 'notifyChat',
	notifyChores: 'notifyChores',
};
const tx = {
	select: () => ({
		from: () => ({ where: () => ({ limit: async () => [stored] }) }),
	}),
	update: () => ({
		set: () => ({ where: () => ({ returning: async () => [{ id: 'm1' }] }) }),
	}),
	delete: () => ({ where: async () => undefined }),
};

mock.module('@/core/db', { namedExports: { pushSubscriptions: {}, wgMembers } });
mock.module('@/core/db/account-deletion', {
	namedExports: { lockActiveAccountMember: async () => ({ id: 'm1', name: 'Mina' }) },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort: class extends Error {},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...p: unknown[]) => p,
		desc: (p: unknown) => p,
		eq: (...p: unknown[]) => p,
		inArray: (...p: unknown[]) => p,
		isNotNull: (p: unknown) => p,
		isNull: (p: unknown) => p,
		ne: (...p: unknown[]) => p,
		notInArray: (...p: unknown[]) => p,
		or: (...p: unknown[]) => p,
		sql: () => ({}),
	},
});

const { updateNotificationSettings } = await import('./notification-writes');
const writer = { wgId: 'wg-1', memberId: 'm1', authUserId: 'u1' };

test('settings update reports only the fields whose value differs from the stored one', async () => {
	const unchanged = await updateNotificationSettings(tx as never, writer, {
		notifyChat: true,
		notifyChores: false,
	});
	assert.deepEqual(unchanged?.changed, []);

	const partly = await updateNotificationSettings(tx as never, writer, {
		notifyChat: false,
		notifyChores: false,
	});
	assert.deepEqual(partly?.changed, ['notifyChat']);
});
