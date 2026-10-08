import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

const key = '11111111-1111-4111-8111-111111111111';
const scope = 'wg-create:auth-user';
const wgs = { shareCode: 'shareCode' };
const wgMembers = {};
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
};
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Row = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Condition = { kind: string; parts: any[] };
const condition = (kind: string, ...parts: unknown[]): Condition => ({ kind, parts });

interface HarnessState {
	wgs: Row[];
	members: Row[];
	slot: { body: Row; expiresAt: Date } | null;
	claims: number;
	audits: number;
	events: string[];
	failAt: string | null;
	shareCodeExhausted: boolean;
	accountDeleted: boolean;
	claimBody: Row;
	pauseAudit: boolean;
	auditReached: () => void;
	auditGate: Promise<void>;
}

// The mocks below read the state of the harness currently in use.
let state: HarnessState;

const withTransaction = async (operation: (tx: unknown) => Promise<unknown>) => {
	const draft = structuredClone({ wgs: state.wgs, members: state.members, slot: state.slot });
	const tx = {
		select: () => ({
			from: (table: unknown) => {
				assert.equal(table, idempotencyResponses);
				return {
					where: (where: Condition) => ({
						limit: () => ({
							for: async (lock: string) => {
								assert.equal(lock, 'update');
								assert.deepEqual(
									where,
									condition('and', condition('eq', 'scope', scope), condition('eq', 'key', key)),
								);
								state.events.push('lock');
								return draft.slot
									? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }]
									: [];
							},
						}),
					}),
				};
			},
		}),
		insert: (table: unknown) => ({
			values: (values: Row) => ({
				returning: async () => {
					if (table === wgs) {
						state.events.push('wg_insert');
						const row = { ...values, id: 'wg-1' };
						draft.wgs.push(row);
						return [row];
					}
					assert.equal(table, wgMembers);
					state.events.push('member_insert');
					if (state.failAt === 'member') return [];
					const row = { ...values, id: 'member-1' };
					draft.members.push(row);
					return [row];
				},
			}),
		}),
		update: (table: unknown) => {
			assert.equal(table, idempotencyResponses);
			return {
				set: (values: Row) => ({
					where: (where: Condition) => ({
						returning: async () => {
							state.events.push('replay_update');
							assert.equal(where.kind, 'and');
							assert.deepEqual(where.parts.slice(0, 2), [
								condition('eq', 'scope', scope),
								condition('eq', 'key', key),
							]);
							if (state.failAt === 'replay' || draft.slot?.body?._claimed !== true) return [];
							draft.slot = { body: values.responseBody, expiresAt: values.expiresAt };
							return [{ scope }];
						},
					}),
				}),
			};
		},
	};
	const result = await operation(tx);
	Object.assign(state, draft);
	state.events.push('commit');
	return result;
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			state.audits += 1;
			state.events.push('audit');
			state.auditReached();
			if (state.pauseAudit) await state.auditGate;
		},
	},
});
mock.module('@/core/auth/server', {
	namedExports: { getAuthenticatedUser: async () => ({ id: 'auth-user' }) },
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			query: {
				wgs: { findFirst: async () => (state.shareCodeExhausted ? { id: 'existing' } : null) },
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
		idempotencyResponses,
		wgMembers,
		wgs,
	},
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		assertAccountCanAcquireMembership: async () => {
			if (state.accountDeleted) throw new TransactionAbort('account_deletion_pending');
		},
	},
});
mock.module('@/core/db/schema', { namedExports: { LIMITS: { NAME_MAX: 100 } } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort, withTransaction } });
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => {
			state.claims += 1;
			if (state.slot && state.slot.expiresAt > new Date()) return false;
			state.slot = { body: state.claimBody, expiresAt: new Date(Date.now() + 60_000) };
			return true;
		},
		getCachedResponse: async () => (state.slot?.body?._claimed ? null : (state.slot?.body ?? null)),
		readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		rateLimitFailMode: () => 'open',
		registerLimiter: {},
	},
});
mock.module('@/core/utils/share-code', {
	namedExports: { generateShareCode: () => 'MTE8PZAT', isValidShareCode: () => true },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => condition('and', ...parts),
		eq: (column: unknown, value: unknown) => condition('eq', column, value),
		gt: (column: unknown, value: unknown) => condition('gt', column, value),
		sql: () => condition('sql'),
	},
});

const route = await import('../src/app/api/wg/route.ts');

function harness({
	failAt = null as string | null,
	pauseAudit = false,
	claimBody = { _claimed: true } as Row,
	accountDeleted = false,
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
		wgs: [],
		members: [],
		slot: null,
		claims: 0,
		audits: 0,
		events: [],
		failAt,
		shareCodeExhausted: false,
		accountDeleted,
		claimBody,
		pauseAudit,
		auditReached,
		auditGate,
	};
	state = own;
	const request = () =>
		new Request('http://localhost/api/wg', {
			method: 'POST',
			headers: { 'idempotency-key': key },
			body: JSON.stringify({ name: 'WG', creatorName: 'Mina' }),
		});
	return {
		state: own,
		post: () => {
			state = own;
			return route.POST(request() as never);
		},
		atAudit,
		releaseAudit,
	};
}

test('retry replays the committed WG response while the first request is still finishing', async () => {
	const { state, post, atAudit, releaseAudit } = harness({ pauseAudit: true });
	const first = post();
	await atAudit;
	assert.equal(state.slot?.body.status, 200);
	assert.equal(state.wgs.length, 1);
	const secondResponse = await post();
	releaseAudit();
	const firstResponse = await first;
	assert.equal(secondResponse.status, 200);
	assert.deepEqual(await secondResponse.json(), await firstResponse.json());
	assert.equal(state.wgs.length, 1);
	assert.equal(state.members.length, 1);
	assert.equal(state.claims, 1);
	assert.equal(state.audits, 1);
	assert.deepEqual(state.events.slice(0, 5), [
		'lock',
		'wg_insert',
		'member_insert',
		'replay_update',
		'commit',
	]);
	assert.ok((state.slot?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 24 * 60 * 60 * 1000);
});

for (const failAt of ['member', 'replay']) {
	test(`${failAt} failure rolls back WG and creator before response publication`, async () => {
		const { state, post } = harness({ failAt });
		const response = await post();
		assert.equal(response.status, 500);
		assert.equal(state.wgs.length, 0);
		assert.equal(state.members.length, 0);
		// The rolled-back request frees its claim, so the same-key retry runs at once.
		assert.equal(state.slot, null);
		assert.equal(state.audits, 0);
		state.failAt = null;
		const retry = await post();
		assert.equal(retry.status, 200);
		assert.equal(state.wgs.length, 1);
		assert.equal(state.members.length, 1);
	});
}

test('transaction replays a completed row that appears after claim acquisition', async () => {
	const completed = {
		status: 201,
		body: { wg: { id: 'other-wg' }, creator: { id: 'other-member' } },
	};
	const { state, post } = harness({ claimBody: completed });
	const response = await post();
	assert.equal(response.status, 201);
	assert.deepEqual(await response.json(), completed.body);
	assert.equal(state.wgs.length, 0);
	assert.equal(state.members.length, 0);
	assert.equal(state.audits, 0);
});

test('cached account-creation replay is refused after the account fence', async () => {
	const { state, post } = harness({ accountDeleted: true });
	state.slot = {
		body: { status: 200, body: { wg: { id: 'old-wg' }, creator: { id: 'old-member' } } },
		expiresAt: new Date(Date.now() + 60_000),
	};
	const response = await post();
	assert.equal(response.status, 409);
	assert.deepEqual(await response.json(), {
		error: 'account_deletion_pending',
		code: 'account_deletion_pending',
	});
	assert.equal(state.wgs.length, 0);
	assert.equal(state.members.length, 0);
	assert.equal(state.claims, 0);
});

test('a non-claim row never authorizes WG creation', async () => {
	const { state, post } = harness({ claimBody: { unexpected: true } });
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.wgs.length, 0);
	assert.equal(state.members.length, 0);
});

test('share-code exhaustion leaves no claim, so retry can create immediately', async () => {
	const { state, post } = harness();
	state.shareCodeExhausted = true;
	const failed = await post();
	assert.equal(failed.status, 500);
	assert.equal(state.claims, 0);
	assert.equal(state.slot, null);
	assert.equal(state.wgs.length, 0);
	state.shareCodeExhausted = false;
	const retry = await post();
	assert.equal(retry.status, 200);
	assert.equal(state.claims, 1);
	assert.equal(state.wgs.length, 1);
});
