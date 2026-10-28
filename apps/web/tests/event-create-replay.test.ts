import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { jsonb, PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '../src/core/db/transaction-abort.ts';

const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at'),
});
const wgEvents = {};
const wgId = '989ac820-58b7-431f-9c65-28721264f333';
const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const key = '550e8400-e29b-41d4-a716-446655440000';
// biome-ignore lint/suspicious/noExplicitAny: fake rows carry arbitrary shapes
type Row = Record<string, any>;

interface HarnessState {
	slot: { body: Row; expiresAt: Date } | null;
	events: Row[];
	audits: number;
	notifications: number;
	failBaseWrite: boolean;
	failCommit: boolean;
	failAudit: boolean;
	replaceClaimOnRollback: boolean;
	warning: string | null;
	cachedResponse: Row | null;
	claimResult: Row | null;
	claimAttempts: number;
	releases: number;
	claimWhere: string;
	baseWhere: string;
	warningWhere: string;
	releaseWhere: string;
}

// The mocks below read the state of the harness currently in use.
let state: HarnessState;
let transactionTail: Promise<void> = Promise.resolve();
const dialect = new PgDialect();

const withTransaction = async (operation: (tx: unknown) => Promise<unknown>) => {
	const previous = transactionTail;
	let unlock: () => void = () => undefined;
	transactionTail = new Promise<void>((resolve) => {
		unlock = resolve;
	});
	await previous;
	const draft = structuredClone({ slot: state.slot, events: state.events });
	const tx = {
		select: () => ({
			from: () => ({
				where: (condition: never) => ({
					limit: () => ({
						for: async (lock: string) => {
							assert.equal(lock, 'update');
							state.claimWhere = dialect.sqlToQuery(condition).sql;
							return draft.slot ? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }] : [];
						},
					}),
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Row) => ({
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
			set: (values: Row) => ({
				where: (condition: never) => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						state.baseWhere = dialect.sqlToQuery(condition).sql;
						if (state.failBaseWrite) throw new Error('replay_write_failed');
						if (
							!draft.slot ||
							Object.keys(draft.slot.body).length !== 1 ||
							draft.slot.body._claimed !== true
						)
							return [];
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
};

const db = {
	insert: () => {
		throw new Error('event insert escaped transaction');
	},
	delete: (table: unknown) => ({
		where: (condition: never) => ({
			returning: async () => {
				assert.equal(table, idempotencyResponses);
				const query = dialect.sqlToQuery(condition);
				state.releaseWhere = query.sql;
				const lease = Date.parse(query.params[2] as string);
				if (
					!state.slot ||
					Object.keys(state.slot.body).length !== 1 ||
					state.slot.body._claimed !== true ||
					lease !== state.slot.expiresAt.getTime()
				) {
					return [];
				}
				state.slot = null;
				state.releases += 1;
				return [{ scope: 'released' }];
			},
		}),
	}),
	update: (table: unknown) => ({
		set: (values: Row) => ({
			where: (condition: never) => ({
				returning: async () => {
					assert.equal(table, idempotencyResponses);
					state.warningWhere = dialect.sqlToQuery(condition).sql;
					assert.match(dialect.sqlToQuery(values.responseBody).sql, /jsonb_set/);
					const slot = state.slot;
					if (
						!slot ||
						slot.body.body?.event?.id !== state.events[0]?.id ||
						slot.body.body.warning !== null
					)
						return [];
					slot.body.body.warning = state.warning;
					return [{ scope: 'claimed' }];
				},
			}),
		}),
	}),
};

mock.module('@/core/audit', {
	namedExports: {
		recordAuditEvent: async () => {
			assert.equal(state.events.length, 1, 'audit runs after commit');
			if (state.failAudit) throw new Error('audit_failed');
			state.audits += 1;
		},
	},
});
mock.module('@/core/db', { namedExports: { db, idempotencyResponses, wgEvents } });
mock.module('@/core/db/transaction', { namedExports: { TransactionAbort, withTransaction } });
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
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
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: wgId, name: 'WG', shareCode: 'ABCDEFGH' },
			member: { memberId, name: 'Mina' },
		}),
	},
});
mock.module('@/core/guards/with-wg-route', {
	namedExports: {
		withWgRoute:
			(_name: string, handler: (...args: unknown[]) => Promise<Response>) =>
			async (...args: unknown[]) => {
				try {
					return await handler(...args);
				} catch {
					return Response.json({ error: 'server_error' }, { status: 500 });
				}
			},
	},
});
// setReplayWarning is the real implementation, run against the mocked db (its SQL is asserted
// below); the remaining store functions are driven by the harness.
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
const realStore = await import('../src/core/idempotency-store.ts');
mock.module('@/core/idempotency-store', {
	namedExports: {
		claimResponseSlot: async () => true,
		getCachedResponse: async () => state.cachedResponse,
		readIdempotencyKey: (req: Request) => req.headers.get('idempotency-key'),
		setReplayWarning: (...args: Parameters<typeof realStore.setReplayWarning>) =>
			realStore.setReplayWarning(...args),
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
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => 'ip',
		wgReadLimiter: {},
		wgWriteLimiter: {},
	},
});
mock.module('@/features/events/server/event-reminder-window', {
	namedExports: {
		buildEventsWindowFilter: () => undefined,
		withEventWindowCandidates: async () => undefined,
	},
});
mock.module('@/features/events/events', {
	namedExports: {
		canonicalRecurrenceRule: () => ({ ok: true, rule: null }),
		serializeWgEvent: (row: Row) => ({
			id: row.id,
			title: row.title,
			startsAt: row.startsAt.toISOString(),
		}),
	},
});

const route = await import('../src/app/api/wg/[code]/events/route.ts');

function harness() {
	const own: HarnessState = {
		slot: { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) },
		events: [],
		audits: 0,
		notifications: 0,
		failBaseWrite: false,
		failCommit: false,
		failAudit: false,
		replaceClaimOnRollback: false,
		warning: null,
		cachedResponse: null,
		claimResult: null,
		claimAttempts: 0,
		releases: 0,
		claimWhere: '',
		baseWhere: '',
		warningWhere: '',
		releaseWhere: '',
	};
	transactionTail = Promise.resolve();
	state = own;
	const post = () => {
		state = own;
		return route.POST(
			new Request('http://localhost/api/wg/ABCDEFGH/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': key },
				body: JSON.stringify({ title: 'Planung', startsAt: '2026-09-25T20:00:00.000Z' }),
			}) as never,
			{ code: 'ABCDEFGH' } as never,
		);
	};
	return { state: own, post };
}

// The assertions below narrow `state.slot`; reading it through a function keeps it widened.
const slotOf = (state: HarnessState) => state.slot;

test('legacy response envelopes replay their original status and body at every read path', async () => {
	const storedResponses = [
		{ status: 200, body: { event: { id: 'existing-event' }, warning: null } },
		{ status: 429, body: { error: 'rate_limited' } },
		{ status: 500, body: { error: 'insert_failed' } },
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
	const { state, post } = harness();
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
	assert.equal(slotOf(state)?.body.status, retry.status);
	assert.deepEqual(await retry.json(), slotOf(state)?.body.body);
	assert.equal(slotOf(state)?.body.body.event.id, state.events[0]?.id);
	assert.ok((slotOf(state)?.expiresAt.getTime() ?? 0) > Date.now() + 6 * 24 * 60 * 60 * 1000);
	assert.match(state.claimWhere, /for update|scope/);
	assert.match(state.baseWhere, /response_body.*_claimed/);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 1);
	assert.equal(state.claimAttempts, 2);
});

test('unknown commit outcome retains the claim', async () => {
	const { state, post } = harness();
	state.failCommit = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.releases, 0);
	assert.deepEqual(slotOf(state)?.body, { _claimed: true });
});

test('post-commit side-effect failure retains the completed response', async () => {
	const { state, post } = harness();
	state.failAudit = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.events.length, 1);
	assert.equal(slotOf(state)?.body.body.event.id, state.events[0]?.id);
	assert.equal(state.releases, 0);
});

test('rollback release cannot delete a newer claim lease', async () => {
	const { state, post } = harness();
	state.failBaseWrite = true;
	state.replaceClaimOnRollback = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.releases, 0);
	assert.deepEqual(slotOf(state)?.body, { _claimed: true });
	assert.match(state.releaseWhere, /expires_at/);
});

test('two apparent claim winners serialize and replay one event', async () => {
	const { state, post } = harness();
	const [first, second] = await Promise.all([post(), post()]);
	assert.equal(first.status, 200);
	assert.equal(second.status, 200);
	assert.deepEqual(await first.json(), await second.json());
	assert.equal(state.events.length, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.notifications, 1);
});

test('only the exact claim marker can insert an event', async () => {
	const { state, post } = harness();
	if (state.slot) state.slot.body = { _claimed: true, unexpected: true };
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.events.length, 0);
	assert.equal(state.audits, 0);
	assert.equal(state.notifications, 0);
});

test('warning update targets the same completed event', async () => {
	const { state, post } = harness();
	state.warning = 'notification_delivery_failed';
	const response = await post();
	assert.equal(response.status, 200);
	assert.equal((await response.json()).warning, state.warning);
	assert.equal(slotOf(state)?.body.body.warning, state.warning);
	assert.match(state.warningWhere, /response_body.*body.*event.*id/);
	assert.match(state.warningWhere, /response_body.*body.*warning/);
});
