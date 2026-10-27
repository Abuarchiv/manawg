import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const announcementId = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const authorId = '44444444-4444-4444-8444-444444444444';

let source = 'manual';
let authorMemberId = authorId;
// The caller as the transaction reads it, which can differ from the guard's earlier decision.
let caller: { deactivatedAt: Date | null; role: string } | undefined;
// False when the version guard matches no row, like a post saved by someone else meanwhile.
let updateMatches = true;
let guardAllows = true;
let sets: Record<string, unknown>[] = [];
let storedStatus = 'open';
let dispatched = 0;

const announcements = {
	id: 'announcements.id',
	wgId: 'announcements.wg_id',
	updatedAt: 'announcements.updated_at',
};
const wgMembers = { id: 'wg_members.id', wgId: 'wg_members.wg_id' };

const db = {
	select: (fields: Record<string, unknown>) => ({
		from: (table: unknown) => ({
			// Unlimited reads (the takers of a resolved post) find none.
			where: () =>
				Object.assign(Promise.resolve([]), {
					limit: () => {
						const rows =
							table === wgMembers
								? caller
									? [caller]
									: []
								: 'status' in fields
									? [
											{
												id: announcementId,
												authorMemberId,
												content: 'Alt',
												status: storedStatus,
												source,
											},
										]
									: [{ id: announcementId }];
						return Object.assign(Promise.resolve(rows), { for: async () => rows });
					},
				}),
		}),
	}),
	update: () => ({
		set: (values: Record<string, unknown>) => {
			sets.push(values);
			return {
				where: () => ({
					returning: async () =>
						updateMatches
							? [{ id: announcementId, status: 'open', kind: 'info', pinnedAt: null, ...values }]
							: [],
				}),
			};
		},
	}),
};

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: { announcementReactions: {}, announcements, db, wgMembers },
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: { revokePrivateImageIfUnreferenced: async () => ({ ok: true }) },
});
mock.module('@/core/db/transaction', {
	namedExports: {
		lockExpensePayments: async () => undefined,
		withTransaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
	},
});
mock.module('@/core/guards/admin', {
	namedExports: {
		isWgAdmin: async () => false,
		requireOwnerOrAdmin: async (_wg: string, member: { memberId: string }, owner: string) =>
			guardAllows || owner === member.memberId
				? null
				: Response.json({ error: 'not_owner' }, { status: 403 }),
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
			member: { memberId: actorId, name: 'Alex' },
		}),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			dispatched += 1;
			return { warning: null };
		},
	},
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...conditions: unknown[]) => conditions,
		eq: (column: unknown, value: unknown) => ({ column, value }),
		sql: (parts: unknown, ...values: unknown[]) => ({ parts, values }),
	},
});

const { PATCH } = await import('./route');

function setup() {
	source = 'manual';
	authorMemberId = authorId;
	caller = { deactivatedAt: null, role: 'admin' };
	updateMatches = true;
	guardAllows = true;
	sets = [];
	storedStatus = 'open';
	dispatched = 0;
}

function patch(body: unknown) {
	return PATCH(
		new Request('https://example.invalid/x', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT', id: announcementId }) } as never,
	);
}

test('an admin edits the text of a post by someone else', async () => {
	setup();
	const response = await patch({ content: ' Neu ', expectedUpdatedAt: '2026-01-01T10:00:00.000Z' });
	assert.equal(response.status, 200);
	assert.equal(sets[0]?.content, 'Neu');
});

test('the author edits the own post', async () => {
	setup();
	authorMemberId = actorId;
	caller = { deactivatedAt: null, role: 'member' };
	assert.equal((await patch({ content: 'Neu' })).status, 200);
});

test('a role lost between guard and write is refused under the lock', async () => {
	setup();
	caller = { deactivatedAt: null, role: 'member' };
	const response = await patch({ content: 'Neu' });
	assert.equal(response.status, 403);
	assert.equal(sets.length, 0);
});

test('a member who moved out meanwhile cannot save', async () => {
	setup();
	caller = { deactivatedAt: new Date(), role: 'admin' };
	const response = await patch({ content: 'Neu' });
	assert.equal(response.status, 401);
	assert.equal(sets.length, 0);
});

test('a newer version answers 409', async () => {
	setup();
	updateMatches = false;
	const response = await patch({ content: 'Neu', expectedUpdatedAt: '2026-01-01T10:00:00.000Z' });
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'announcement_changed' });
});

test('generated posts keep their text', async () => {
	setup();
	source = 'chore_swap';
	const response = await patch({ content: 'Neu' });
	assert.equal(response.status, 403);
	assert.equal(sets.length, 0);
});

test('resolving an open post stamps the resolver and pushes once', async () => {
	setup();
	authorMemberId = actorId;
	assert.equal((await patch({ status: 'resolved' })).status, 200);
	assert.equal(sets[0]?.status, 'resolved');
	assert.equal(sets[0]?.resolvedByMemberId, actorId);
	assert.equal(dispatched, 1);
});

test('resolving an already resolved post keeps the first resolver and does not push', async () => {
	setup();
	authorMemberId = actorId;
	storedStatus = 'resolved';
	assert.equal((await patch({ status: 'resolved' })).status, 200);
	assert.equal(sets[0]?.resolvedAt, undefined);
	assert.equal(sets[0]?.resolvedByMemberId, undefined);
	assert.equal(dispatched, 0);
});
