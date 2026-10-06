import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PgDialect, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { mockDb } from '../../../tests/support/db-mock';
import { mockObservability } from '../../../tests/support/route-harness';
import { TransactionAbort } from '../../core/db/transaction-abort';

// Real drizzle, claim protocol and idempotency store against an in-memory claim slot; the SQL
// sent for releases and warning updates is rendered and inspected.

const claimKey = '11111111-1111-4111-8111-111111111111';
const scope = 'announcement-comment:wg:member:post';
const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});

type Slot = Record<string, unknown> & { _claimed?: boolean; body?: { warning?: unknown } };
interface RenderedQuery {
	sql: string;
	params: unknown[];
}

function createState() {
	return {
		slot: null as Slot | null,
		rows: [] as string[],
		claims: 0,
		rateLimited: false,
		failReplayWrite: false,
		failCommit: false,
		warningUpdateSucceeds: true,
		staleRead: false,
		warningWhere: '',
		releaseWhere: '',
		transientReleaseQuery: null as RenderedQuery | null,
		claimExpiry: new Date(Date.now() + 15 * 60_000),
		prior: Promise.resolve(),
	};
}

let state = createState();
const render = (condition: unknown): RenderedQuery =>
	new PgDialect().sqlToQuery(condition as never) as RenderedQuery;

interface FakeTx {
	write: () => void;
}

/** Transactions run one at a time and commit their copy of the slot and rows only on success. */
async function withTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
	const waitFor = state.prior;
	let release: () => void = () => undefined;
	state.prior = new Promise((resolve) => {
		release = resolve;
	});
	await waitFor;
	let slot = structuredClone(state.slot);
	const rows = [...state.rows];
	const tx = {
		write: () => rows.push('created'),
		delete: () => ({
			where: (condition: unknown) => ({
				returning: async () => {
					state.transientReleaseQuery = render(condition);
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
}

mockObservability();
mockDb({
	idempotencyResponses,
	withTransaction,
	db: {
		// The store's replay read; a stale read sees no stored response yet.
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (state.staleRead || !state.slot ? [] : [{ body: state.slot }]),
				}),
			}),
		}),
		delete: () => ({
			where: (condition: unknown) => ({
				returning: async () => {
					state.releaseWhere = render(condition).sql;
					if (!state.slot?._claimed) return [];
					state.slot = null;
					return [{ scope }];
				},
			}),
		}),
		update: () => ({
			set: () => ({
				where: (condition: unknown) => ({
					returning: async () => {
						state.warningWhere = render(condition).sql;
						if (!state.warningUpdateSucceeds || !state.slot?.body) return [];
						state.slot.body.warning = 'notification_delivery_failed';
						return [{ scope }];
					},
				}),
			}),
		}),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort,
		withTransaction,
		lockExpensePayments: async () => undefined,
	},
});
mock.module('@/core/guards/replay-slot', {
	namedExports: {
		claimReplaySlot: async () => {
			state.claims++;
			if (!state.slot) state.slot = { _claimed: true };
			return { won: true };
		},
	},
});

const { persistAnnouncementReplayWarning, withAnnouncementReplay } = await import(
	'./announcement-replay'
);

type LegacyResponse = Parameters<typeof withAnnouncementReplay>[3];

function harness() {
	state = createState();
	const mutate = async (tx: unknown) => {
		if (state.rateLimited) {
			return { response: { status: 429, body: { error: 'too_many_requests' } }, effect: null };
		}
		(tx as FakeTx).write();
		return {
			response: { status: 200, body: { id: 'comment-1', warning: null }, entityId: 'comment-1' },
			effect: 'created',
		};
	};
	return {
		state,
		run: (legacyResponse?: LegacyResponse) =>
			withAnnouncementReplay(
				new Request('https://example.invalid', {
					method: 'POST',
					headers: { 'Idempotency-Key': claimKey },
				}),
				scope,
				mutate,
				legacyResponse,
			),
		persistWarning: () =>
			persistAnnouncementReplayWarning(
				scope,
				claimKey,
				'comment-1',
				'notification_delivery_failed',
			),
	};
}

test('concurrent claim retries write once and replay the committed response', async () => {
	const { run } = harness();
	const [first, replay] = await Promise.all([run(), run()]);
	assert.deepEqual(first.response, replay.response);
	assert.equal(first.effect, 'created');
	assert.equal(replay.effect, null);
	assert.deepEqual(state.rows, ['created']);
});

test('replay write failure rolls back and releases the exact claim for retry', async () => {
	const { run } = harness();
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
	const { run } = harness();
	state.rateLimited = true;
	assert.equal((await run()).response.status, 429);
	assert.equal(state.slot, null);
	assert.deepEqual(state.rows, []);
	assert.equal(state.releaseWhere, '');
	assert.match(state.transientReleaseQuery?.sql ?? '', /expires_at/);
	assert.match(state.transientReleaseQuery?.sql ?? '', /_claimed/);
	assert.deepEqual(state.transientReleaseQuery?.params, [
		scope,
		claimKey,
		state.claimExpiry.toISOString(),
	]);
	state.rateLimited = false;
	const success = await run();
	assert.equal(success.response.status, 200);
	assert.deepEqual((await run()).response, success.response);
	assert.deepEqual(state.rows, ['created']);
	assert.equal(state.claims, 2);
});

test('an uncertain rate-limit transaction commit does not release the claim outside the transaction', async () => {
	const { run } = harness();
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
	const { run, persistWarning } = harness();
	await run();
	assert.equal(await persistWarning(), true);
	assert.equal(state.slot?.body?.warning, 'notification_delivery_failed');
	assert.match(state.warningWhere, /entityId/);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /warning/);
});

test('legacy flat response replays from cache and from locked row', async () => {
	const legacyResponse: LegacyResponse = (value) => {
		const id = (value as { announcement?: { id?: string } } | null)?.announcement?.id;
		return id ? { status: 200, body: value, entityId: id } : null;
	};
	for (const staleRead of [false, true]) {
		const { run } = harness();
		state.slot = { announcement: { id: 'old-post' }, warning: null };
		state.staleRead = staleRead;
		const result = await run(legacyResponse);
		assert.deepEqual(result.response.body, state.slot);
		assert.equal(result.effect, null);
		assert.deepEqual(state.rows, []);
	}
});
