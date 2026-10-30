import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const announcementId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const authorId = '44444444-4444-4444-8444-444444444444';
const announcementComments = { id: 'comments.id' };
const announcementReactions = {
	memberId: 'reactions.member_id',
	announcementId: 'reactions.announcement_id',
};
const announcements = { id: 'announcements.id', wgId: 'announcements.wg_id' };
const wgMembers = { id: 'members.id' };

let activeMember = true;
let deactivateAfterGuard = false;
let createdComments: Record<string, unknown>[] = [];
let replayLockedWgId: string | undefined;
let notificationCount = 0;

function query(rows: unknown[]) {
	return Object.assign(Promise.resolve(rows), {
		limit: () => Object.assign(Promise.resolve(rows), { for: async () => rows }),
		for: async () => rows,
	});
}

const tx = {
	select: () => ({
		from: (table: unknown) => ({
			where: () =>
				query(table === announcements ? [{ id: announcementId, authorMemberId: authorId }] : []),
		}),
	}),
	insert: (table: unknown) => ({
		values: (values: Record<string, unknown>) => ({
			returning: async () => {
				assert.equal(table, announcementComments);
				const comment = {
					id: `comment-${createdComments.length + 1}`,
					createdAt: new Date('2026-10-30T10:00:00.000Z'),
					...values,
				};
				createdComments.push(comment);
				return [comment];
			},
		}),
	}),
};

const db = {
	select: () => ({
		from: () => ({ where: async () => [] }),
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: { announcementComments, announcementReactions, announcements, db, wgMembers },
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async () =>
			activeMember
				? { id: actorId, name: 'Alex', role: 'member', authUserId: 'auth-1', deactivatedAt: null }
				: null,
	},
});
mock.module('@/core/db/with-replay', {
	namedExports: {
		withIdempotentReplay: async (
			_req: Request,
			_scope: string,
			mutate: (
				client: typeof tx,
			) => Promise<{ response: { status: number; body: unknown }; effect: unknown }>,
			wgIdForLock?: string,
		) => {
			replayLockedWgId = wgIdForLock;
			return { ...(await mutate(tx)), key: null };
		},
		persistReplayWarning: async () => true,
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => {
			const auth = {
				ok: true,
				wg: { id: wgId, name: 'WG', shareCode: 'ABCD2345' },
				member: { memberId: actorId, name: 'Alex', color: 'blue' },
				authUserId: 'auth-1',
			};
			if (deactivateAfterGuard) {
				deactivateAfterGuard = false;
				activeMember = false;
			}
			return auth;
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			notificationCount += 1;
			return { warning: null };
		},
	},
});

const { POST } = await import('./route');

function setup() {
	activeMember = true;
	deactivateAfterGuard = false;
	createdComments = [];
	replayLockedWgId = undefined;
	notificationCount = 0;
}

test('a comment is not created after a concurrent move-out', async () => {
	setup();
	deactivateAfterGuard = true;
	const response = await POST(
		new Request('https://example.invalid/comments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'Bin dabei' }),
		}) as never,
		{ params: Promise.resolve({ code: 'ABCD2345', id: announcementId }) } as never,
	);

	assert.equal(response.status, 401);
	assert.equal((await response.json()).error, 'member_deactivated');
	assert.deepEqual(createdComments, []);
	assert.equal(notificationCount, 0);
	assert.equal(replayLockedWgId, wgId);
});
