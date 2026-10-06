import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { mockDb } from '../../../../../../tests/support/db-mock';
import { mockDrizzle } from '../../../../../../tests/support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from '../../../../../../tests/support/route-harness';
import { TransactionAbort } from '../../../../../core/db/transaction-abort';

const key = '11111111-1111-4111-8111-111111111111';
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const choreId = '44444444-4444-4444-8444-444444444444';

// Private image URLs are only accepted for the app's own origin.
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
Reflect.deleteProperty(process.env, 'VERCEL_URL');

const announcements = { id: 'id' };
const chores = { id: 'chore-id', wgId: 'chore-wg' };

interface ReplayResponse {
	status: number;
	body: { warning?: unknown };
	entityId?: string;
}
interface Outcome {
	response: ReplayResponse;
	effect: unknown;
}
type CreatedRow = Record<string, unknown> & { id: string };

const state = {
	created: [] as CreatedRow[],
	audits: 0,
	notifications: 0,
	warning: null as string | null,
	warningUpdateSucceeds: true,
	legacy: null as unknown,
	rejectImageAttachment: false,
	replayWgId: null as string | null,
	existingChoreId: null as string | null,
	announcementResults: [] as unknown[][],
	announcementQueries: 0,
	cache: new Map<string, ReplayResponse>(),
	prior: Promise.resolve(),
};

function reset(): void {
	state.created = [];
	state.audits = 0;
	state.notifications = 0;
	state.warning = null;
	state.warningUpdateSucceeds = true;
	state.legacy = null;
	state.rejectImageAttachment = false;
	state.replayWgId = null;
	state.existingChoreId = null;
	state.announcementResults = [];
	state.announcementQueries = 0;
	state.cache = new Map();
	state.prior = Promise.resolve();
}

const tx = {
	select: () => ({
		from: (table: unknown) => {
			assert.equal(table, chores);
			return {
				where: () => ({
					limit: async () => (state.existingChoreId ? [{ id: state.existingChoreId }] : []),
				}),
			};
		},
	}),
	insert: (table: unknown) => ({
		values: (value: Record<string, unknown>) => ({
			returning: async () => {
				assert.equal(table, announcements);
				const row = { ...value, id: `announcement-${state.created.length + 1}` };
				state.created.push(row);
				return [row];
			},
		}),
	}),
};

/** Serializes writes per process, replays per scope and key, and reads legacy rows. */
async function withAnnouncementReplay(
	req: Request,
	scope: string,
	mutate: (handle: typeof tx) => Promise<Outcome>,
	legacyResponse: (value: unknown) => ReplayResponse | null,
	wgIdForLock?: string,
) {
	state.replayWgId = wgIdForLock ?? null;
	const replayKey = req.headers.get('idempotency-key');
	const cacheKey = `${scope}:${replayKey}`;
	const waitFor = state.prior;
	let release: () => void = () => undefined;
	state.prior = new Promise((resolve) => {
		release = resolve;
	});
	await waitFor;
	try {
		if (state.legacy) {
			return { response: legacyResponse(state.legacy), effect: null, key: replayKey };
		}
		const cached = state.cache.get(cacheKey);
		if (cached) return { response: cached, effect: null, key: replayKey };
		const outcome = await mutate(tx);
		state.cache.set(cacheKey, outcome.response);
		return { ...outcome, key: replayKey };
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
mockDb({
	announcements,
	chores,
	db: {
		select: () => ({
			from: (table: unknown) => {
				const rows =
					table === announcements
						? (state.announcementResults[state.announcementQueries++] ?? [])
						: [];
				const query = Object.assign(Promise.resolve(rows), {
					innerJoin: () => query,
					where: () => query,
					orderBy: () => query,
					limit: () => query,
				});
				return query;
			},
		}),
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits++;
		},
	},
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: {
		assertPrivateImageCanBeAttached: async () => {
			if (state.rejectImageAttachment) throw new TransactionAbort('image_removed');
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			assert.equal(state.created.length, 1, 'push must run after create');
			state.notifications++;
			return { warning: state.warning };
		},
	},
});
mock.module('@/features/pinnwand/server/announcement-replay', {
	namedExports: {
		withAnnouncementReplay,
		persistAnnouncementReplayWarning: async (
			scope: string,
			replayKey: string,
			entityId: string,
			warning: unknown,
		) => {
			if (!state.warningUpdateSucceeds) return false;
			const response = state.cache.get(`${scope}:${replayKey}`);
			if (response?.entityId !== entityId) return false;
			response.body.warning = warning;
			return true;
		},
	},
});

const { GET, POST } = await import('./route');

const get = () => GET(request('/api/wg/MTE8PZAT/announcements'), routeCtx());
const post = (imageUrl: string | null = null, extra: Record<string, unknown> = {}) =>
	POST(
		request('/api/wg/MTE8PZAT/announcements', {
			method: 'POST',
			headers: { 'Idempotency-Key': key },
			body: { content: 'Hello', kind: 'info', imageUrl, source: 'system', ...extra },
		}),
		routeCtx(),
	);

test('concurrent create retry returns one announcement and runs push once', async () => {
	reset();
	const [first, replay] = await Promise.all([post(), post()]);
	assert.deepEqual(await first.json(), await replay.json());
	assert.equal(state.created.length, 1);
	assert.equal(state.created[0]?.authorMemberId, memberId);
	assert.equal(state.created[0]?.source, 'manual');
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 1);
	assert.equal(state.replayWgId, wgId);
});

test('old flat cached response replays without another create', async () => {
	reset();
	state.legacy = { announcement: { id: 'legacy-id' }, warning: null };
	assert.deepEqual(await (await post()).json(), state.legacy);
	assert.equal(state.created.length, 0);
	assert.equal(state.notifications, 0);
});

test('warning is returned only when its completed response is updated', async () => {
	reset();
	state.warning = 'notification_delivery_failed';
	const first = await (await post()).json();
	const replay = await (await post()).json();
	assert.equal(first.warning, state.warning);
	assert.equal(replay.warning, state.warning);
	assert.equal(state.notifications, 1);

	reset();
	state.warning = 'notification_delivery_failed';
	state.warningUpdateSucceeds = false;
	assert.equal((await (await post()).json()).warning, null);
	assert.equal((await (await post()).json()).warning, null);
	assert.equal(state.created.length, 1);
});

test('revoked private image attachment returns 409 without creating an announcement', async () => {
	reset();
	state.rejectImageAttachment = true;
	const response = await post(
		'https://app.example/api/upload/read?key=manawg%2F22222222-2222-4222-8222-222222222222%2Fannouncement%2F33333333-3333-4333-8333-333333333333.jpg',
	);
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), { error: 'image_removed', code: 'image_removed' });
	assert.equal(state.created.length, 0);
	assert.equal(state.notifications, 0);
});

test('client-chosen provenance is stored as a manual post', async () => {
	for (const extra of [
		{ source: 'chore_swap', sourcePath: '/putzen?highlight=forged' },
		{ source: 'expense', sourcePath: '/ausgaben' },
		{ source: 'shopping', sourcePath: '/einkauf' },
		{ source: 'chore_swap', choreId },
	]) {
		reset();
		assert.equal((await post(null, extra)).status, 200);
		assert.equal(state.created[0]?.source, 'manual');
		assert.equal(state.created[0]?.sourcePath, null);
	}
});

test('a swap request for a chore of this WG keeps a server-built source path', async () => {
	for (const extra of [
		{ source: 'chore_swap', choreId },
		{ source: 'chore_swap', sourcePath: `/putzen?highlight=${choreId}` },
	]) {
		reset();
		state.existingChoreId = choreId;
		assert.equal((await post(null, extra)).status, 200);
		assert.equal(state.created[0]?.source, 'chore_swap');
		assert.equal(state.created[0]?.sourcePath, `/putzen?highlight=${choreId}`);
	}
});

test('GET keeps open member posts that system notices pushed out of the newest window', async () => {
	reset();
	const announcement = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
		id,
		createdAt: new Date(createdAt),
		pinnedAt: null,
		status: 'open',
		source: 'manual',
		...extra,
	});
	const pinned = announcement('pinned', '2026-01-01T00:00:00Z', {
		pinnedAt: new Date('2026-09-01'),
	});
	const notice = announcement('notice', '2026-09-20T00:00:00Z', { source: 'shopping' });
	const recentOpen = announcement('recent-open', '2026-09-10T00:00:00Z');
	const oldOpen = announcement('old-open', '2026-02-01T00:00:00Z');
	state.announcementResults = [
		[pinned, notice, recentOpen],
		[recentOpen, oldOpen],
	];

	const response = await get();
	assert.equal(response.status, 200);
	const { announcements: items } = (await response.json()) as { announcements: { id: string }[] };
	assert.deepEqual(
		items.map((item) => item.id),
		['pinned', 'notice', 'recent-open', 'old-open'],
	);
	assert.equal(state.announcementQueries, 2);
});
