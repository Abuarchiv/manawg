import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { SQL } from 'drizzle-orm';
import { jsonb, PgDialect, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { TransactionAbort } from '@/core/db/transaction-abort';

const claimKey = '11111111-1111-4111-8111-111111111111';
const scope = 'announcement-comment:wg:member:post';
const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});

type Slot = Record<string, unknown> | null;
type Tx = { write: () => unknown };

// harness() installs its fakes here; the mocked modules delegate to the current harness.
const active = {
	db: {} as Record<string, (...args: never[]) => unknown>,
	withTransaction: (async () => undefined) as (operation: (tx: Tx) => unknown) => Promise<unknown>,
	claimReplaySlot: (async () => ({ won: true })) as (
		scope: string,
		key: string,
		deps: { claim: (scope: string, key: string) => Promise<boolean> },
	) => Promise<unknown>,
};

mock.module('@/core/db', {
	namedExports: {
		db: {
			delete: (...args: never[]) => active.db.delete?.(...args),
			insert: (...args: never[]) => active.db.insert?.(...args),
			select: (...args: never[]) => active.db.select?.(...args),
			update: (...args: never[]) => active.db.update?.(...args),
		},
		idempotencyResponses,
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		lockExpensePayments: async () => undefined,
		withTransaction: (operation: (tx: Tx) => unknown) => active.withTransaction(operation),
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: (...args: Parameters<typeof active.claimReplaySlot>) =>
			active.claimReplaySlot(...args),
	},
});
mock.module('@/core/infra/observability', { namedExports: { logApiError: () => undefined } });

const { persistReplayWarning, withIdempotentReplay } = await import('./with-replay');

function harness() {
	const state = {
		slot: null as Slot,
		rows: [] as string[],
		claims: 0,
		failReplayWrite: false,
		failCommit: false,
		warningUpdateSucceeds: true,
		staleRead: false,
		warningWhere: '',
		releaseWhere: '',
		claimExpiry: new Date(Date.now() + 15 * 60_000),
	};
	let prior = Promise.resolve();
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (state.staleRead || !state.slot ? [] : [{ body: state.slot }]),
				}),
			}),
		}),
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: () => ({
					returning: async () => {
						if (!state.slot) state.slot = { _claimed: true };
						return [{ expiresAt: state.claimExpiry }];
					},
				}),
			}),
		}),
		delete: () => ({
			where: (condition: SQL) => ({
				returning: async () => {
					state.releaseWhere = new PgDialect().sqlToQuery(condition).sql;
					if (!state.slot?._claimed) return [];
					state.slot = null;
					return [{ scope }];
				},
			}),
		}),
		update: () => ({
			set: () => ({
				where: (condition: SQL) => ({
					returning: async () => {
						state.warningWhere = new PgDialect().sqlToQuery(condition).sql;
						if (!state.warningUpdateSucceeds) return [];
						(state.slot as { body: { warning: string } }).body.warning =
							'notification_delivery_failed';
						return [{ scope }];
					},
				}),
			}),
		}),
	};
	const withTransaction = async (operation: (tx: Tx) => unknown) => {
		const waitFor = prior;
		let release: () => void = () => undefined;
		prior = new Promise((resolve) => {
			release = resolve;
		});
		await waitFor;
		let slot = structuredClone(state.slot);
		const rows = [...state.rows];
		const tx = {
			write: () => rows.push('created'),
			delete: () => ({
				where: () => ({
					returning: async () => {
						if (JSON.stringify(slot) !== '{"_claimed":true}') return [];
						slot = null;
						return [{ scope }];
					},
				}),
			}),
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => ({
							for: async () => (slot ? [{ body: slot, expiresAt: state.claimExpiry }] : []),
						}),
					}),
				}),
			}),
			update: () => ({
				set: (value: { responseBody: Slot }) => ({
					where: () => ({
						returning: async () => {
							if (state.failReplayWrite) throw new Error('cache_write_failed');
							if (JSON.stringify(slot) !== '{"_claimed":true}') return [];
							slot = value.responseBody;
							return [{ scope }];
						},
					}),
				}),
			}),
		};
		try {
			const result = await operation(tx);
			if (state.failCommit) throw new Error('commit_outcome_unknown');
			state.slot = slot;
			state.rows = rows;
			return result;
		} finally {
			release();
		}
	};
	active.db = db as never;
	active.withTransaction = withTransaction as never;
	active.claimReplaySlot = async (claimScope, key, deps) => {
		state.claims++;
		await deps.claim(claimScope, key);
		return { won: true };
	};
	const request = new Request('https://example.invalid', {
		method: 'POST',
		headers: { 'Idempotency-Key': claimKey },
	});
	const mutate = async (tx: Tx) => {
		tx.write();
		return {
			response: { status: 200, body: { id: 'comment-1', warning: null }, entityId: 'comment-1' },
			effect: 'created',
		};
	};
	return {
		state,
		run: (admit?: () => Promise<{ status: number; body: unknown } | null>) =>
			withIdempotentReplay(request, scope, mutate as never, undefined, admit),
		persistWarning: () =>
			persistReplayWarning(scope, claimKey, 'comment-1', 'notification_delivery_failed'),
	};
}

test('concurrent claim retries write once and replay the committed response', async () => {
	const { state, run } = harness();
	const [first, replay] = await Promise.all([run(), run()]);
	assert.deepEqual(first.response, replay.response);
	assert.equal(first.effect, 'created');
	assert.equal(replay.effect, null);
	assert.deepEqual(state.rows, ['created']);
});

test('replay write failure rolls back and releases the exact claim for retry', async () => {
	const { state, run } = harness();
	state.failReplayWrite = true;
	await assert.rejects(run(), /cache_write_failed/);
	assert.deepEqual(state.rows, []);
	assert.equal(state.slot, null);
	assert.match(state.releaseWhere, /expires_at/);
	assert.match(state.releaseWhere, /_claimed/);
	state.failReplayWrite = false;
	assert.equal((await run()).effect, 'created');
	assert.equal(state.claims, 2);
});

test('admit refuses after the claim, releases it exactly, and a stored replay still wins', async () => {
	const { state, run } = harness();
	let calls = 0;
	const refuse = async () => {
		calls += 1;
		return { status: 429, body: { error: 'too_many_requests' } };
	};
	const refused = await run(refuse);
	assert.equal(refused.response.status, 429);
	assert.equal(refused.effect, null);
	assert.equal(state.claims, 1);
	assert.equal(state.slot, null);
	assert.deepEqual(state.rows, []);
	assert.match(state.releaseWhere, /expires_at/);
	assert.match(state.releaseWhere, /_claimed/);
	assert.equal((await run()).response.status, 200);
	const replayed = await run(refuse);
	assert.equal(replayed.response.status, 200);
	assert.equal(calls, 1);
	assert.equal(state.claims, 2);
	assert.deepEqual(state.rows, ['created']);
});

test('a throwing admit releases the claim and rethrows', async () => {
	const { state, run } = harness();
	await assert.rejects(
		run(async () => {
			throw new Error('limiter_down');
		}),
		/limiter_down/,
	);
	assert.equal(state.slot, null);
	assert.deepEqual(state.rows, []);
	assert.equal((await run()).effect, 'created');
});

test('uncertain COMMIT and malformed claim do not release the claim', async () => {
	const uncertain = harness();
	uncertain.state.failCommit = true;
	await assert.rejects(uncertain.run(), /commit_outcome_unknown/);
	assert.deepEqual(uncertain.state.slot, { _claimed: true });
	assert.equal(uncertain.state.releaseWhere, '');

	const malformed = harness();
	malformed.state.slot = { _claimed: true, extra: 1 };
	await assert.rejects(malformed.run(), /idempotency_claim_invalid/);
	assert.deepEqual(malformed.state.rows, []);
});

test('warning enrichment is conditional on entity and completed response', async () => {
	const { state, run, persistWarning } = harness();
	await run();
	assert.equal(await persistWarning(), true);
	assert.equal(
		(state.slot as { body: { warning: string } }).body.warning,
		'notification_delivery_failed',
	);
	assert.match(state.warningWhere, /entityId/);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /warning/);
});
