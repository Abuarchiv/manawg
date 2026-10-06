import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';
import { mockDb } from './support/db-mock';
import {
	mockObservability,
	mockRateLimit,
	mockWgMember,
	request,
	routeCtx,
} from './support/route-harness';

// The event create route with real drizzle, the real claim protocol, the real idempotency store
// and the real event schemas; one claim slot and the events live in memory, and the SQL of
// every claim step is rendered and inspected.

const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at'),
});
const wgEvents = { name: 'wg_events' };
const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const key = '550e8400-e29b-41d4-a716-446655440000';

type Body = Record<string, unknown> & {
	_claimed?: boolean;
	status?: number;
	body?: { event?: { id?: string }; warning?: unknown };
};
interface Slot {
	body: Body;
	expiresAt: Date;
}
type EventRow = Record<string, unknown> & { id: string };

function createState() {
	return {
		slot: { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) } as Slot | null,
		events: [] as EventRow[],
		audits: 0,
		notifications: 0,
		failBaseWrite: false,
		failCommit: false,
		failAudit: false,
		replaceClaimOnRollback: false,
		warning: null as string | null,
		cachedResponse: null as Body | null,
		claimResult: null as { won: boolean; cached?: unknown } | null,
		claimAttempts: 0,
		releases: 0,
		claimWhere: '',
		baseWhere: '',
		warningWhere: '',
		releaseWhere: '',
		transactionTail: Promise.resolve(),
	};
}

let state = createState();
const dialect = new PgDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as never);
const isExactClaim = (body: Body | undefined) =>
	body !== undefined && Object.keys(body).length === 1 && body._claimed === true;

/** Transactions run one at a time and commit their copy of the slot and events on success. */
async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const previous = state.transactionTail;
	let unlock: () => void = () => undefined;
	state.transactionTail = new Promise((resolve) => {
		unlock = resolve;
	});
	await previous;
	const draft = structuredClone({ slot: state.slot, events: state.events });
	const tx = {
		select: () => ({
			from: () => ({
				where: (condition: unknown) => ({
					limit: () => ({
						for: async (lock: string) => {
							assert.equal(lock, 'update');
							state.claimWhere = render(condition).sql;
							return draft.slot ? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }] : [];
						},
					}),
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => ({
				returning: async () => {
					assert.equal(table, wgEvents);
					const row = {
						...values,
						id: `event-${draft.events.length + 1}`,
						createdAt: new Date(),
						updatedAt: new Date(),
					};
					draft.events.push(row);
					return [row];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: { responseBody: Body; expiresAt: Date }) => ({
				where: (condition: unknown) => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						state.baseWhere = render(condition).sql;
						if (state.failBaseWrite) throw new Error('replay_write_failed');
						if (!draft.slot || !isExactClaim(draft.slot.body)) return [];
						draft.slot = { body: values.responseBody, expiresAt: values.expiresAt };
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
	};
	try {
		const result = await operation(tx);
		if (state.failCommit) throw new Error('commit_outcome_unknown');
		state.slot = draft.slot;
		state.events = draft.events;
		return result;
	} catch (err) {
		if (state.replaceClaimOnRollback && state.slot) {
			state.slot = {
				body: { _claimed: true },
				expiresAt: new Date(state.slot.expiresAt.getTime() + 1_000),
			};
		}
		throw err;
	} finally {
		unlock();
	}
}

mockObservability();
mockRateLimit();
mockWgMember({ wg: { id: wgId, name: 'WG', shareCode: 'MTE8PZAT' }, member: { memberId, name: 'Mina' } });
mockDb({
	idempotencyResponses,
	wgEvents,
	withTransaction,
	db: {
		insert: () => {
			throw new Error('event insert escaped transaction');
		},
		// The store's replay read.
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (state.cachedResponse ? [{ body: state.cachedResponse }] : []),
				}),
			}),
		}),
		delete: (table: unknown) => ({
			where: (condition: unknown) => ({
				returning: async () => {
					assert.equal(table, idempotencyResponses);
					const query = render(condition);
					state.releaseWhere = query.sql;
					const lease = Date.parse(String(query.params[2]));
					if (!state.slot || !isExactClaim(state.slot.body) || lease !== state.slot.expiresAt.getTime()) {
						return [];
					}
					state.slot = null;
					state.releases += 1;
					return [{ scope: 'released' }];
				},
			}),
		}),
		update: (table: unknown) => ({
			set: (values: { responseBody: unknown }) => ({
				where: (condition: unknown) => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						state.warningWhere = render(condition).sql;
						assert.match(render(values.responseBody).sql, /jsonb_set/);
						const stored = state.slot?.body.body;
						if (!stored || stored.event?.id !== state.events[0]?.id || stored.warning !== null) {
							return [];
						}
						stored.warning = state.warning;
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort, withTransaction, lockExpensePayments: async () => undefined },
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claimAttempts += 1;
			if (state.claimResult) return state.claimResult;
			if (!state.slot) {
				state.slot = { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
			}
			return { won: true };
		},
	},
});
mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			assert.equal(state.events.length, 1, 'audit runs after commit');
			if (state.failAudit) throw new Error('audit_failed');
			state.audits += 1;
		},
	},
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: {
		dispatchNotificationSafely: async () => {
			assert.equal(state.events.length, 1, 'notification runs after commit');
			state.notifications += 1;
			return { warning: state.warning };
		},
	},
});

const { POST } = await import('../src/app/api/wg/[code]/events/route.ts');

function harness() {
	state = createState();
	const post = () =>
		POST(
			request('/api/wg/MTE8PZAT/events', {
				method: 'POST',
				headers: { 'idempotency-key': key },
				body: { title: 'Planung', startsAt: '2026-09-25T20:00:00.000Z' },
			}),
			routeCtx(),
		);
	return { state, post };
}

test('legacy response envelopes replay their original status and body at every read path', async () => {
	const storedResponses: Body[] = [
		{ status: 200, body: { event: { id: 'existing-event' }, warning: null } },
		{ status: 429, body: { error: 'rate_limited' } } as Body,
		{ status: 500, body: { error: 'insert_failed' } } as Body,
	];
	for (const legacy of storedResponses) {
		const assertReplay = async (response: Response) => {
			assert.equal(response.status, legacy.status);
			assert.deepEqual(await response.json(), legacy.body);
		};

		const cached = harness();
		cached.state.cachedResponse = legacy;
		await assertReplay(await cached.post());
		assert.equal(cached.state.events.length, 0);

		const claimed = harness();
		claimed.state.claimResult = { won: false, cached: legacy };
		await assertReplay(await claimed.post());
		assert.equal(claimed.state.events.length, 0);

		const locked = harness();
		locked.state.slot = { body: legacy, expiresAt: new Date(Date.now() + 60_000) };
		await assertReplay(await locked.post());
		assert.equal(locked.state.events.length, 0);
	}
});

test('event and replay response roll back together; retry creates once', async () => {
	const { post } = harness();
	state.failBaseWrite = true;
	const failed = await post();
	assert.equal(failed.status, 500);
	assert.equal(state.events.length, 0);
	assert.equal(state.slot, null, 'confirmed rollback frees the exact claim');
	assert.equal(state.releases, 1);
	assert.match(state.releaseWhere, /scope.*key.*expires_at.*response_body/);
	assert.equal(state.audits, 0);
	assert.equal(state.notifications, 0);

	state.failBaseWrite = false;
	const retry = await post();
	assert.equal(retry.status, 200);
	assert.equal(state.events.length, 1);
	const slot = state.slot as Slot | null;
	assert.equal(slot?.body.status, retry.status);
	assert.deepEqual(await retry.json(), slot?.body.body);
	assert.equal(slot?.body.body?.event?.id, state.events[0]?.id);
	assert.ok((slot?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 24 * 60 * 60 * 1000);
	assert.match(state.claimWhere, /for update|scope/);
	assert.match(state.baseWhere, /response_body.*_claimed/);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 1);
	assert.equal(state.claimAttempts, 2);
});

test('unknown commit outcome retains the claim', async () => {
	const { post } = harness();
	state.failCommit = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.releases, 0);
	assert.deepEqual(state.slot?.body, { _claimed: true });
});

test('post-commit side-effect failure retains the completed response', async () => {
	const { post } = harness();
	state.failAudit = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.events.length, 1);
	assert.equal(state.slot?.body.body?.event?.id, state.events[0]?.id);
	assert.equal(state.releases, 0);
});

test('rollback release cannot delete a newer claim lease', async () => {
	const { post } = harness();
	state.failBaseWrite = true;
	state.replaceClaimOnRollback = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.releases, 0);
	assert.deepEqual(state.slot?.body, { _claimed: true });
	assert.match(state.releaseWhere, /expires_at/);
});

test('two apparent claim winners serialize and replay one event', async () => {
	const { post } = harness();
	const [first, second] = await Promise.all([post(), post()]);
	assert.equal(first.status, 200);
	assert.equal(second.status, 200);
	assert.deepEqual(await first.json(), await second.json());
	assert.equal(state.events.length, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 1);
});

test('only the exact claim marker can insert an event', async () => {
	const { post } = harness();
	(state.slot as Slot).body = { _claimed: true, unexpected: true };
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.events.length, 0);
	assert.equal(state.audits, 0);
	assert.equal(state.notifications, 0);
});

test('warning update targets the same completed event', async () => {
	const { post } = harness();
	state.warning = 'notification_delivery_failed';
	const response = await post();
	assert.equal(response.status, 200);
	assert.equal((await response.json()).warning, state.warning);
	assert.equal(state.slot?.body.body?.warning, state.warning);
	assert.match(state.warningWhere, /response_body.*body.*event.*id/);
	assert.match(state.warningWhere, /response_body.*body.*warning/);
});
