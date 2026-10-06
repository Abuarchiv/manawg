import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import { readIdempotencyKey } from './support/claim-table';
import { mockDb } from './support/db-mock';
import { conditionArg, drizzleData, mockDrizzle } from './support/drizzle-mock';
import { mockObservability, mockRateLimit, request } from './support/route-harness';

// The WG create route with the real claim protocol and replay slot; the WG, its creator and one
// claim slot live in memory and roll back with their transaction.

const key = '11111111-1111-4111-8111-111111111111';
const scope = 'wg-create:auth-user';
const wgs = { shareCode: 'shareCode' };
const wgMembers = { name: 'wg_members' };
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
};

type Body = Record<string, unknown> & { _claimed?: boolean; status?: number };
interface Slot {
	body: Body;
	expiresAt: Date;
}

function createState(options: {
	failAt?: 'member' | 'replay' | null;
	pauseAudit?: boolean;
	claimBody?: Body;
	accountDeleted?: boolean;
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
		wgs: [] as Record<string, unknown>[],
		members: [] as Record<string, unknown>[],
		slot: null as Slot | null,
		claims: 0,
		audits: 0,
		events: [] as string[],
		failAt: options.failAt ?? null,
		pauseAudit: options.pauseAudit ?? false,
		claimBody: options.claimBody ?? ({ _claimed: true } as Body),
		shareCodeExhausted: false,
		accountDeleted: options.accountDeleted ?? false,
		atAudit,
		auditReached,
		auditGate,
		releaseAudit,
	};
}

let state = createState({});

const scopeAndKey = drizzleData.and(
	drizzleData.eq(idempotencyResponses.scope, scope),
	drizzleData.eq(idempotencyResponses.key, key),
);

async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const draft = structuredClone({ wgs: state.wgs, members: state.members, slot: state.slot });
	const tx = {
		select: () => ({
			from: (table: unknown) => {
				assert.equal(table, idempotencyResponses);
				return {
					where: (where: unknown) => ({
						limit: () => ({
							for: async (lock: string) => {
								assert.equal(lock, 'update');
								assert.deepEqual(where, scopeAndKey);
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
			values: (values: Record<string, unknown>) => ({
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
				set: (values: { responseBody: Body; expiresAt: Date }) => ({
					where: (where: { op: string; args: unknown[] }) => ({
						returning: async () => {
							state.events.push('replay_update');
							assert.equal(where.op, 'and');
							assert.deepEqual(where.args.slice(0, 2), scopeAndKey.args);
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
}

mockDrizzle();
mockObservability();
mockRateLimit();
mockDb({
	idempotencyResponses,
	wgMembers,
	wgs,
	db: {
		query: {
			wgs: { findFirst: async () => (state.shareCodeExhausted ? { id: 'existing' } : null) },
		},
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
	namedExports: { TransactionAbort, withTransaction, lockExpensePayments: async () => undefined },
});
mock.module('@/core/auth/server', {
	namedExports: { getAuthenticatedUser: async () => ({ id: 'auth-user' }) },
});
mock.module('@/core/db/account-deletion', {
	namedExports: {
		assertAccountCanAcquireMembership: async () => {
			if (state.accountDeleted) throw new TransactionAbort('account_deletion_pending');
		},
	},
});
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
mock.module('@/core/idempotency-store', {
	namedExports: {
		readIdempotencyKey,
		claimResponseSlot: async () => {
			state.claims += 1;
			if (state.slot && state.slot.expiresAt > new Date()) return false;
			state.slot = { body: state.claimBody, expiresAt: new Date(Date.now() + 60_000) };
			return true;
		},
		getCachedResponse: async () => (state.slot?.body?._claimed ? null : (state.slot?.body ?? null)),
		setReplayWarning: async () => false,
	},
});

const { POST } = await import('../src/app/api/wg/route.ts');

function harness(options: Parameters<typeof createState>[0] = {}) {
	state = createState(options);
	const post = () =>
		POST(
			request('/api/wg', {
				method: 'POST',
				headers: { 'idempotency-key': key },
				body: { name: 'WG', creatorName: 'Mina' },
			}),
		);
	return { state, post };
}

test('retry replays the committed WG response while the first request is still finishing', async () => {
	const { post } = harness({ pauseAudit: true });
	const first = post();
	await state.atAudit;
	assert.equal(state.slot?.body.status, 200);
	assert.equal(state.wgs.length, 1);
	const secondResponse = await post();
	state.releaseAudit();
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

for (const failAt of ['member', 'replay'] as const) {
	test(`${failAt} failure rolls back WG and creator before response publication`, async () => {
		const { post } = harness({ failAt });
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
	const { post } = harness({ claimBody: completed });
	const response = await post();
	assert.equal(response.status, 201);
	assert.deepEqual(await response.json(), completed.body);
	assert.equal(state.wgs.length, 0);
	assert.equal(state.members.length, 0);
	assert.equal(state.audits, 0);
});

test('cached account-creation replay is refused after the account fence', async () => {
	const { post } = harness({ accountDeleted: true });
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
	const { post } = harness({ claimBody: { unexpected: true } });
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.wgs.length, 0);
	assert.equal(state.members.length, 0);
});

test('share-code exhaustion leaves no claim, so retry can create immediately', async () => {
	const { post } = harness();
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
