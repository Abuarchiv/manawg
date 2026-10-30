import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const announcementId = '11111111-1111-4111-8111-111111111111';
const commentId = '22222222-2222-4222-8222-222222222222';
const wgId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const authorId = '55555555-5555-4555-8555-555555555555';
const announcementComments = {
	id: { field: 'id' },
	announcementId: { field: 'announcementId' },
	memberId: { field: 'memberId' },
	content: { field: 'content' },
};
const announcements = { id: { field: 'id' }, wgId: { field: 'wgId' } };
const wgMembers = {
	id: { field: 'id' },
	wgId: { field: 'wgId' },
	deactivatedAt: { field: 'deactivatedAt' },
	role: { field: 'role' },
};

let active = true;
let role = 'member';
let commentAuthorId = authorId;
let deactivateAfterGuard = false;
let demoteAfterAdminCheck = false;
let commentLockOf: unknown;
let writes: string[] = [];

const db = {
	select: () => ({
		from: (table: unknown) => {
			const builder = {
				innerJoin: () => builder,
				where: () => {
					const rows =
						table === wgMembers
							? [{ deactivatedAt: active ? null : new Date(), role }]
							: [{ memberId: commentAuthorId }];
					return Object.assign(Promise.resolve(rows), {
						limit: () =>
							Object.assign(Promise.resolve(rows), {
								for: async (_strength: string, config?: { of?: unknown }) => {
									if (table === announcementComments) commentLockOf = config?.of;
									return rows;
								},
							}),
					});
				},
			};
			return builder;
		},
	}),
	update: () => ({
		set: (values: Record<string, unknown>) => ({
			where: () => ({
				returning: async () => {
					writes.push('update');
					return [{ id: commentId, announcementId, memberId: authorId, ...values }];
				},
			}),
		}),
	}),
	delete: () => ({
		where: () => ({
			returning: async () => {
				writes.push('delete');
				return [{ id: commentId }];
			},
		}),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: { announcementComments, announcements, db, wgMembers },
});
mock.module('@/core/guards/admin', {
	namedExports: {
		isWgAdmin: async () => {
			if (demoteAfterAdminCheck) {
				demoteAfterAdminCheck = false;
				role = 'member';
				return true;
			}
			return role === 'admin';
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => {
			const result = {
				ok: true,
				wg: { id: wgId, name: 'WG', shareCode: 'ABCD2345' },
				member: { memberId: actorId, name: 'Alex' },
				authUserId: 'auth-1',
			};
			if (deactivateAfterGuard) {
				deactivateAfterGuard = false;
				active = false;
			}
			return result;
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		withTransaction: async (operation: (tx: typeof db) => Promise<unknown>) => {
			if (demoteAfterAdminCheck) {
				demoteAfterAdminCheck = false;
				role = 'member';
			}
			return operation(db);
		},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (column: unknown, value: unknown) => ({ column, value }),
	},
});

const { DELETE, PATCH } = await import('./route');

function setup() {
	active = true;
	role = 'member';
	commentAuthorId = authorId;
	deactivateAfterGuard = false;
	demoteAfterAdminCheck = false;
	commentLockOf = undefined;
	writes = [];
}

function request(method: 'DELETE' | 'PATCH', body?: unknown) {
	return method === 'PATCH'
		? PATCH(
				new Request('https://example.invalid/comments', {
					method,
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
				}) as never,
				{ params: Promise.resolve({ code: 'ABCD2345', id: announcementId, commentId }) } as never,
			)
		: DELETE(
				new Request('https://example.invalid/comments', { method }) as never,
				{ params: Promise.resolve({ code: 'ABCD2345', id: announcementId, commentId }) } as never,
			);
}

test('a comment author can no longer save an edit after moving out', async () => {
	setup();
	commentAuthorId = actorId;
	deactivateAfterGuard = true;

	const response = await request('PATCH', { content: 'Neu' });
	assert.equal(response.status, 401);
	assert.equal(writes.length, 0);
});

test('an active comment author can edit their own comment', async () => {
	setup();
	commentAuthorId = actorId;

	const response = await request('PATCH', { content: 'Neu' });
	assert.equal(response.status, 200);
	assert.deepEqual(writes, ['update']);
	assert.equal(commentLockOf, announcementComments);
});

test('a just-demoted admin can no longer delete another member’s comment', async () => {
	setup();
	role = 'admin';
	demoteAfterAdminCheck = true;

	const response = await request('DELETE');
	assert.equal(response.status, 403);
	assert.equal(writes.length, 0);
	assert.equal(commentLockOf, announcementComments);
});

test('an active admin can delete another member’s comment', async () => {
	setup();
	role = 'admin';

	const response = await request('DELETE');
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { deleted: true });
	assert.deepEqual(writes, ['delete']);
	assert.equal(commentLockOf, announcementComments);
});
