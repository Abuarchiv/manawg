import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

const key = '11111111-1111-4111-8111-111111111111';
const calendarSubscriptions = { wgId: 'wgId', memberId: 'memberId', revokedAt: 'revokedAt' };
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'body',
	expiresAt: 'expiresAt',
};
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Row = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Condition = { kind: string; parts: any[] };
const condition = (kind: string, ...parts: unknown[]): Condition => ({ kind, parts });

interface HarnessState {
	subscription: Row | null;
	slot: { body: Row; expiresAt: Date } | null;
	claims: number;
	audits: number;
	seeds: number;
	failReplayWrite: boolean;
	memberActive: boolean;
	pauseAudit: boolean;
	auditReached: () => void;
	auditGate: Promise<void>;
}

// The mocks below read the state of the harness currently in use.
let state: HarnessState;

const withTransaction = async (operation: (tx: unknown) => Promise<unknown>) => {
	const draft = structuredClone({ subscription: state.subscription, slot: state.slot });
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () =>
						table === idempotencyResponses
							? {
									for: async (lock: string) => {
										assert.equal(lock, 'update');
										return draft.slot
											? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }]
											: [];
									},
								}
							: {
									for: async (lock: string) => {
										assert.equal(lock, 'update');
										return draft.subscription ? [draft.subscription] : [];
									},
								},
				}),
			}),
		}),
		update: (table: unknown) => ({
			set: (values: Row) => ({
				where: () => ({
					returning: async () => {
						if (table === idempotencyResponses) {
							if (state.failReplayWrite || draft.slot?.body?._claimed !== true) return [];
							draft.slot = { body: values.responseBody, expiresAt: values.expiresAt };
							return [{ scope: 'written' }];
						}
						assert.equal(table, calendarSubscriptions);
						if (!draft.subscription) return [];
						if (draft.subscription.revokedAt && !Object.hasOwn(values, 'revokedAt')) return [];
						if (draft.subscription.revokedAt && values.revokedAt !== null) return [];
						draft.subscription = { ...draft.subscription, ...values };
						return [draft.subscription];
					},
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Row) => ({
				returning: async () => {
					assert.equal(table, calendarSubscriptions);
					assert.equal(draft.subscription, null);
					const now = new Date();
					draft.subscription = { ...values, revokedAt: null, createdAt: now, updatedAt: now };
					return [draft.subscription];
				},
			}),
		}),
	};
	const result = await operation(tx);
	state.subscription = draft.subscription;
	state.slot = draft.slot;
	return result;
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
			state.auditReached();
			if (state.pauseAudit) await state.auditGate;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			query: {
				calendarSubscriptions: {
					findFirst: async () =>
						state.subscription && !state.subscription.revokedAt ? state.subscription : null,
				},
			},
			delete: (table: unknown) => ({
				where: (where: Condition) => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						const lease = where.parts.find(
							(part) => part?.kind === 'eq' && part.parts[0] === idempotencyResponses.expiresAt,
						)?.parts[1];
						if (
							state.slot?.body?._claimed !== true ||
							state.slot.expiresAt.getTime() !== lease?.getTime()
						) {
							return [];
						}
						state.slot = null;
						return [{ scope: 'released' }];
					},
				}),
			}),
		},
		calendarSubscriptions,
		idempotencyResponses,
	},
});
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort, withTransaction } });
mock.module('@/core/db/account-deletion', {
	namedExports: {
		lockActiveAccountMember: async (
			_tx: unknown,
			_wgId: string,
			memberId: string,
			authUserId: string,
		) =>
			state.memberActive
				? { id: memberId, name: 'Mina', role: 'member', authUserId, deactivatedAt: null }
				: null,
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claims += 1;
			if (state.slot && state.slot.expiresAt > new Date())
				return { won: false, cached: state.slot.body };
			state.slot = { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
			return { won: true };
		},
	},
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg-1' },
			member: { memberId: 'member-1', name: 'Mina' },
			authUserId: 'auth-user',
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: { withWgRoute: (_label: string, handler: unknown) => handler },
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => true,
		getCachedResponse: async () => (state.slot?.body?._claimed ? null : (state.slot?.body ?? null)),
		readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		wgReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/features/events/server/calendar-subscription', {
	namedExports: {
		createCalendarFeedSeed: () => `seed-${++state.seeds}`,
		deriveCalendarFeedToken: (_id: string, seed: string) => `${seed}-token`,
		calendarFeedUrl: (_base: string, id: string, token: string) => `/feed/${id}/${token}`,
	},
});
mock.module('@/shared/lib/app-url', { namedExports: { getAppUrl: () => 'http://localhost' } });
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => condition('and', ...parts),
		eq: (...parts: unknown[]) => condition('eq', ...parts),
		gt: (...parts: unknown[]) => condition('gt', ...parts),
		isNull: (...parts: unknown[]) => condition('isNull', ...parts),
		sql: () => condition('sql'),
	},
});

const route = await import('../src/app/api/wg/[code]/calendar-subscription/route.ts');

function harness({
	subscription = null as Row | null,
	pauseAudit = false,
	failReplayWrite = false,
	memberActive = true,
} = {}) {
	let auditReached: () => void = () => {};
	let releaseAudit: () => void = () => {};
	const atAudit = new Promise<void>((resolve) => {
		auditReached = resolve;
	});
	const auditGate = new Promise<void>((resolve) => {
		releaseAudit = resolve;
	});
	const own: HarnessState = {
		subscription,
		slot: null,
		claims: 0,
		audits: 0,
		seeds: 0,
		failReplayWrite,
		memberActive,
		pauseAudit,
		auditReached,
		auditGate,
	};
	state = own;
	const request = (method: string) =>
		new Request('http://localhost/api/wg/MTE8PZAT/calendar-subscription', {
			method,
			headers: { 'idempotency-key': key },
		});
	const handlers = route as unknown as Record<
		string,
		(req: Request, ctx: unknown) => Promise<Response>
	>;
	const call = (method: string) => {
		state = own;
		return (handlers[method] as (req: Request, ctx: unknown) => Promise<Response>)(
			request(method),
			{ code: 'MTE8PZAT' },
		);
	};
	return { state: own, call, atAudit, releaseAudit };
}

function activeSubscription(revokedAt: Date | null = null) {
	return {
		id: 'subscription-1',
		wgId: 'wg-1',
		memberId: 'member-1',
		tokenSeed: 'seed-0',
		revokedAt,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
	};
}

test('rotation retry returns the committed feed URL while audit is pending', async () => {
	const { state, call, atAudit, releaseAudit } = harness({
		subscription: activeSubscription(),
		pauseAudit: true,
	});
	const first = call('PATCH');
	await atAudit;
	assert.equal(state.subscription?.tokenSeed, 'seed-1');
	assert.equal(state.slot?.body.status, 200);
	const duplicate = await call('PATCH');
	releaseAudit();
	const original = await first;
	assert.deepEqual(await duplicate.json(), await original.json());
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.claims, 1);
});

test('a replay never stores the feed URL and follows a later rotation', async () => {
	const { state, call } = harness({ subscription: activeSubscription() });
	const first = await call('PATCH');
	assert.match((await first.json()).subscription.feedUrl, /seed-1-token/);
	assert.ok(!JSON.stringify(state.slot).includes('feedUrl'));
	assert.ok(!JSON.stringify(state.slot).includes('seed-1'));
	// Another rotation happens before the client retries the first request.
	if (state.subscription) state.subscription.tokenSeed = 'seed-9';
	const replay = await call('PATCH');
	assert.equal(replay.status, 200);
	assert.match((await replay.json()).subscription.feedUrl, /seed-9-token/);
	assert.equal(state.seeds, 1);
});

test('failed replay publication rolls token rotation back', async () => {
	const { state, call } = harness({ subscription: activeSubscription(), failReplayWrite: true });
	const response = await call('PATCH');
	assert.equal(response.status, 500);
	assert.equal(state.subscription?.tokenSeed, 'seed-0');
	// The rolled-back request frees its claim, so a same-key retry runs at once.
	assert.equal(state.slot, null);
	assert.equal(state.audits, 0);
	const retry = await call('PATCH');
	assert.equal(retry.status, 500);
});

test('reactivation retry does not regenerate its token', async () => {
	const { state, call } = harness({
		subscription: activeSubscription(new Date('2026-01-02T00:00:00Z')),
	});
	const first = await call('POST');
	const duplicate = await call('POST');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(state.subscription?.revokedAt, null);
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
});

test('revoke retry replays success after the subscription is already revoked', async () => {
	const { state, call } = harness({ subscription: activeSubscription() });
	const first = await call('DELETE');
	const duplicate = await call('DELETE');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(first.status, 200);
	assert.ok(state.subscription?.revokedAt);
	assert.equal(state.audits, 1);
});

test('older flat subscription response replays as HTTP 200 without rotating', async () => {
	const { state, call } = harness({ subscription: activeSubscription() });
	const body = {
		subscription: { feedUrl: '/feed/old', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
	};
	state.slot = { body, expiresAt: new Date(Date.now() + 60_000) };
	const response = await call('POST');
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		subscription: {
			feedUrl: '/feed/subscription-1/seed-0-token',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
	});
	assert.equal(state.seeds, 0);
	assert.equal(state.audits, 0);
});

test('cached calendar credentials are not replayed after member detachment', async () => {
	const { state, call } = harness({ subscription: activeSubscription(), memberActive: false });
	state.slot = {
		body: { status: 200, body: { subscription: { feedUrl: '/feed/old' } } },
		expiresAt: new Date(Date.now() + 60_000),
	};
	const response = await call('PATCH');
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), { error: 'member_deactivated' });
	assert.equal(state.seeds, 0);
	assert.equal(state.audits, 0);
});
