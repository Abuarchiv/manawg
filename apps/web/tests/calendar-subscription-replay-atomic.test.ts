import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import { readIdempotencyKey } from './support/claim-table';
import { mockDb } from './support/db-mock';
import { conditionArg, mockDrizzle } from './support/drizzle-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from './support/route-harness';

// The calendar subscription route with the real claim protocol: one subscription row and one
// claim slot in memory, both rolled back with their transaction.

const key = '11111111-1111-4111-8111-111111111111';
const calendarSubscriptions = { wgId: 'wgId', memberId: 'memberId', revokedAt: 'revokedAt' };
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'body',
	expiresAt: 'expiresAt',
};

interface Subscription extends Record<string, unknown> {
	tokenSeed: string;
	revokedAt: Date | null;
}
interface Slot {
	body: Record<string, unknown> & { _claimed?: boolean; status?: number };
	expiresAt: Date;
}

function createState(options: {
	subscription?: Subscription | null;
	pauseAudit?: boolean;
	failReplayWrite?: boolean;
	memberActive?: boolean;
}) {
	let auditReached: () => void = () => undefined;
	let releaseAudit: () => void = () => undefined;
	const atAudit = new Promise<void>((resolve) => {
		auditReached = resolve;
	});
	const auditGate = new Promise<void>((resolve) => {
		releaseAudit = resolve;
	});
	return {
		subscription: options.subscription ?? null,
		slot: null as Slot | null,
		claims: 0,
		audits: 0,
		seeds: 0,
		pauseAudit: options.pauseAudit ?? false,
		failReplayWrite: options.failReplayWrite ?? false,
		memberActive: options.memberActive ?? true,
		atAudit,
		auditReached,
		auditGate,
		releaseAudit,
	};
}

let state = createState({});

async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const draft = structuredClone({ subscription: state.subscription, slot: state.slot });
	const lockedRow = (rows: unknown[]) => ({
		for: async (lock: string) => {
			assert.equal(lock, 'update');
			return rows;
		},
	});
	const tx = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () =>
						table === idempotencyResponses
							? lockedRow(
									draft.slot ? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }] : [],
								)
							: lockedRow(draft.subscription ? [draft.subscription] : []),
				}),
			}),
		}),
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						if (table === idempotencyResponses) {
							if (state.failReplayWrite || draft.slot?.body?._claimed !== true) return [];
							draft.slot = {
								body: values.responseBody as Slot['body'],
								expiresAt: values.expiresAt as Date,
							};
							return [{ scope: 'written' }];
						}
						assert.equal(table, calendarSubscriptions);
						if (!draft.subscription) return [];
						if (draft.subscription.revokedAt && !Object.hasOwn(values, 'revokedAt')) return [];
						if (draft.subscription.revokedAt && values.revokedAt !== null) return [];
						draft.subscription = { ...draft.subscription, ...values } as Subscription;
						return [draft.subscription];
					},
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => ({
				returning: async () => {
					assert.equal(table, calendarSubscriptions);
					assert.equal(draft.subscription, null);
					const now = new Date();
					draft.subscription = {
						...values,
						revokedAt: null,
						createdAt: now,
						updatedAt: now,
					} as unknown as Subscription;
					return [draft.subscription];
				},
			}),
		}),
	};
	const result = await operation(tx);
	state.subscription = draft.subscription;
	state.slot = draft.slot;
	return result;
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: 'wg-1' }, member: { memberId: 'member-1', name: 'Mina' } }).authUserId =
	'auth-user';
mockDb({
	calendarSubscriptions,
	idempotencyResponses,
	db: {
		query: { calendarSubscriptions: { findFirst: async () => null } },
		delete: (table: unknown) => ({
			where: (condition: unknown) => ({
				returning: async () => {
					assert.equal(table, idempotencyResponses);
					const lease = conditionArg(condition, 'eq', idempotencyResponses.expiresAt) as
						| Date
						| undefined;
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
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort, withTransaction },
});
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
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
			state.auditReached();
			if (state.pauseAudit) await state.auditGate;
		},
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claims += 1;
			if (state.slot && state.slot.expiresAt > new Date()) {
				return { won: false, cached: state.slot.body };
			}
			state.slot = { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
			return { won: true };
		},
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey,
		claimResponseSlot: async () => assert.fail('claims go through the replay slot'),
		getCachedResponse: async () => (state.slot?.body?._claimed ? null : (state.slot?.body ?? null)),
		setReplayWarning: async () => false,
	},
});
mock.module('@/features/events/server/calendar-subscription', {
	namedExports: {
		createCalendarFeedSeed: () => `seed-${++state.seeds}`,
		deriveCalendarFeedToken: (_id: string, seed: string) => `${seed}-token`,
		calendarFeedUrl: (_base: string, id: string, token: string) => `/feed/${id}/${token}`,
		isCalendarFeedToken: () => true,
		verifyCalendarFeedToken: () => true,
	},
});

const route = await import('../src/app/api/wg/[code]/calendar-subscription/route.ts');

function harness(options: Parameters<typeof createState>[0] = {}) {
	state = createState(options);
	const call = (method: 'POST' | 'PATCH' | 'DELETE') =>
		route[method](
			request('/api/wg/MTE8PZAT/calendar-subscription', {
				method,
				headers: { 'idempotency-key': key },
			}),
			routeCtx(),
		);
	return { state, call };
}

function activeSubscription(revokedAt: Date | null = null): Subscription {
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
	const { call } = harness({ subscription: activeSubscription(), pauseAudit: true });
	const first = call('PATCH');
	await state.atAudit;
	assert.equal(state.subscription?.tokenSeed, 'seed-1');
	assert.equal(state.slot?.body.status, 200);
	const duplicate = await call('PATCH');
	state.releaseAudit();
	const original = await first;
	assert.deepEqual(await duplicate.json(), await original.json());
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.claims, 1);
});

test('failed replay publication rolls token rotation back', async () => {
	const { call } = harness({ subscription: activeSubscription(), failReplayWrite: true });
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
	const { call } = harness({ subscription: activeSubscription(new Date('2026-01-02T00:00:00Z')) });
	const first = await call('POST');
	const duplicate = await call('POST');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(state.subscription?.revokedAt, null);
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
});

test('revoke retry replays success after the subscription is already revoked', async () => {
	const { call } = harness({ subscription: activeSubscription() });
	const first = await call('DELETE');
	const duplicate = await call('DELETE');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(first.status, 200);
	assert.ok(state.subscription?.revokedAt);
	assert.equal(state.audits, 1);
});

test('older flat subscription response replays as HTTP 200 without rotating', async () => {
	const { call } = harness({ subscription: activeSubscription() });
	const body = {
		subscription: { feedUrl: '/feed/old', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
	};
	state.slot = { body, expiresAt: new Date(Date.now() + 60_000) };
	const response = await call('POST');
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), body);
	assert.equal(state.seeds, 0);
	assert.equal(state.audits, 0);
});

test('cached calendar credentials are not replayed after member detachment', async () => {
	const { call } = harness({ subscription: activeSubscription(), memberActive: false });
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
