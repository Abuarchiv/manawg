import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../../../tests/support/route-harness';

const announcementId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const authorId = '33333333-3333-4333-8333-333333333333';
const wgId = '44444444-4444-4444-8444-444444444444';
const keyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const keyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const announcements = {
	id: 'id',
	wgId: 'wg_id',
	authorMemberId: 'author_member_id',
	content: 'content',
	status: 'status',
};
const announcementReactions = {
	id: 'id',
	announcementId: 'announcement_id',
	memberId: 'member_id',
	reaction: 'reaction',
};

interface Outcome {
	response: unknown;
	effect: unknown;
}

const state = {
	reaction: null as { id: string } | null,
	status: 'open',
	locks: 0,
	audits: [] as string[],
	notifications: 0,
	cache: new Map<string, unknown>(),
	prior: Promise.resolve(),
};

function reset(): void {
	state.reaction = null;
	state.status = 'open';
	state.locks = 0;
	state.audits = [];
	state.notifications = 0;
	state.cache = new Map();
	state.prior = Promise.resolve();
}

const tx = {
	select: () => ({
		from: (table: unknown) => ({
			where: () => ({
				limit: () =>
					table === announcements
						? {
								for: async () => {
									state.locks++;
									return [
										{
											id: announcementId,
											authorMemberId: authorId,
											content: 'Post',
											status: state.status,
										},
									];
								},
							}
						: Promise.resolve(state.reaction ? [state.reaction] : []),
			}),
		}),
	}),
	delete: (table: unknown) => ({
		where: () => ({
			returning: async () => {
				assert.equal(table, announcementReactions);
				const removed = state.reaction;
				state.reaction = null;
				return removed ? [removed] : [];
			},
		}),
	}),
	insert: (table: unknown) => ({
		values: () => ({
			onConflictDoNothing: () => ({
				returning: async () => {
					assert.equal(table, announcementReactions);
					if (state.reaction) return [];
					state.reaction = { id: 'reaction-1' };
					return [state.reaction];
				},
			}),
		}),
	}),
};

/** Serializes writes per process and replays a stored response per scope and key. */
async function withAnnouncementReplay(
	req: Request,
	scope: string,
	mutate: (handle: typeof tx) => Promise<Outcome>,
) {
	const key = req.headers.get('idempotency-key');
	const cacheKey = `${scope}:${key}`;
	const waitFor = state.prior;
	let release: () => void = () => undefined;
	state.prior = new Promise((resolve) => {
		release = resolve;
	});
	await waitFor;
	try {
		const cached = state.cache.get(cacheKey);
		if (cached) return { response: cached, effect: null, key };
		const outcome = await mutate(tx);
		state.cache.set(cacheKey, outcome.response);
		return { ...outcome, key };
	} finally {
		release();
	}
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({
	wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' },
	member: { memberId, name: 'Member' },
});
mockDb({ announcements, announcementReactions });
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async (event: { eventType: string }) => {
			state.audits.push(event.eventType);
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			state.notifications++;
			return { warning: null };
		},
	},
});
mock.module('@/features/pinnwand/server/announcement-replay', {
	namedExports: {
		withAnnouncementReplay,
		persistAnnouncementReplayWarning: async () => true,
	},
});

const { POST } = await import('./route');

const post = (key: string, active?: boolean) =>
	POST(
		request('/api/wg/MTE8PZAT/announcements/x/reactions', {
			method: 'POST',
			headers: { 'Idempotency-Key': key },
			body: { reaction: 'seen', ...(active === undefined ? {} : { active }) },
		}),
		routeCtx({ id: announcementId }),
	);

test('same key replays an added reaction without toggling it off', async () => {
	reset();
	const first = await (await post(keyA)).json();
	const replay = await (await post(keyA)).json();
	assert.deepEqual(first, replay);
	assert.equal(first.active, true);
	assert.equal(state.reaction?.id, 'reaction-1');
	assert.deepEqual(state.audits, ['announcement.reaction.added']);
	assert.equal(state.notifications, 1);
	assert.equal(state.locks, 1);
});

test('two distinct legacy toggle keys serialize add then remove', async () => {
	reset();
	const [added, removed] = await Promise.all([post(keyA), post(keyB)]);
	assert.equal((await added.json()).active, true);
	assert.equal((await removed.json()).active, false);
	assert.equal(state.reaction, null);
	assert.deepEqual(state.audits, ['announcement.reaction.added', 'announcement.reaction.removed']);
	assert.equal(state.notifications, 1);
	assert.equal(state.locks, 2);
});

test('explicit active true with a new key is a no-op when already active', async () => {
	reset();
	await post(keyA, true);
	const second = await (await post(keyB, true)).json();
	assert.equal(second.active, true);
	assert.equal(state.reaction?.id, 'reaction-1');
	assert.deepEqual(state.audits, ['announcement.reaction.added']);
	assert.equal(state.notifications, 1);
});
