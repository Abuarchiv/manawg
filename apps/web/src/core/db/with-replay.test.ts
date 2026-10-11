import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { TransactionAbort } from '@/core/db/transaction-abort';
import type { SQL } from 'drizzle-orm';
import { PgDialect, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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
	claimReplaySlot: (async () => ({ won: true })) as () => Promise<unknown>,
};

mock.module('@/core/db', {
	namedExports: {
		db: {
			delete: (...args: never[]) => active.db.delete?.(...args),
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
	namedExports: { claimReplaySlot: () => active.claimReplaySlot() },
});
mock.module('@/core/infra/observability', { namedExports: { logApiError: () => undefined } });

const { persistReplayWarning, withIdempotentReplay } = await import('./with-replay');

function harness() {
	const state = {
		slot: null as Slot,
		rows: [] as string[],
		claims: 0,
		rateLimited: false,
		failReplayWrite: false,
		failCommit: false,
		warningUpdateSucceeds: true,
		staleRead: false,
		warningWhere: '',
		releaseWhere: '',
		transientReleaseQuery: null as ReturnType<PgDialect['sqlToQuery']> | null,
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
				where: (condition: SQL) => ({
					returning: async () => {
						state.transientReleaseQuery = new PgDialect().sqlToQuery(condition);
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
	active.claimReplaySlot = async () => {
		state.claims++;
		if (!state.slot) state.slot = { _claimed: true };
		return { won: true };
	};
	const request = new Request('https://example.invalid', {
		method: 'POST',
		headers: { 'Idempotency-Key': claimKey },
	});
	const mutate = async (tx: Tx) => {
		if (state.rateLimited) {
			return { response: { status: 429, body: { error: 'too_many_requests' } }, effect: null };
		}
		tx.write();
		return {
			response: { status: 200, body: { id: 'comment-1', warning: null }, entityId: 'comment-1' },
			effect: 'created',
		};
	};
	return {
		state,
		run: (legacyResponse?: Parameters<typeof withIdempotentReplay>[3]) =>
			withIdempotentReplay(request, scope, mutate as never, legacyResponse),
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

test('a rate-limited write releases its exact claim and succeeds with the same key later', async () => {
	const { state, run } = harness();
	state.rateLimited = true;
	assert.equal((await run()).response.status, 429);
	assert.equal(state.slot, null);
	assert.deepEqual(state.rows, []);
	assert.equal(state.releaseWhere, '');
	const releaseQuery = state.transientReleaseQuery;
	assert.ok(releaseQuery);
	assert.match(releaseQuery.sql, /expires_at/);
	assert.match(releaseQuery.sql, /_claimed/);
	assert.deepEqual(releaseQuery.params, [scope, claimKey, state.claimExpiry.toISOString()]);
	state.rateLimited = false;
	const success = await run();
	assert.equal(success.response.status, 200);
	assert.deepEqual((await run()).response, success.response);
	assert.deepEqual(state.rows, ['created']);
	assert.equal(state.claims, 2);
});

test('an uncertain rate-limit transaction commit does not release the claim outside the transaction', async () => {
	const { state, run } = harness();
	state.rateLimited = true;
	state.failCommit = true;
	await assert.rejects(run(), /commit_outcome_unknown/);
	assert.deepEqual(state.slot, { _claimed: true });
	assert.deepEqual(state.rows, []);
	assert.equal(state.releaseWhere, '');
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

test('legacy flat response replays from cache and from locked row', async () => {
	const legacyResponse = (value: unknown) => {
		const id = (value as { announcement?: { id?: string } } | null)?.announcement?.id;
		return id ? { status: 200, body: value, entityId: id } : null;
	};
	for (const staleRead of [false, true]) {
		const { state, run } = harness();
		state.slot = { announcement: { id: 'old-post' }, warning: null };
		state.staleRead = staleRead;
		const result = await run(legacyResponse);
		assert.deepEqual(result.response.body, state.slot);
		assert.equal(result.effect, null);
		assert.deepEqual(state.rows, []);
	}
});
