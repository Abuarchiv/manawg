import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { PgDialect, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const file = path.join(process.cwd(), 'src/features/pinnwand/announcement-replay.ts');
const claimKey = '11111111-1111-4111-8111-111111111111';
const scope = 'announcement-comment:wg:member:post';
const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});

function harness() {
	const state = {
		slot: null,
		rows: [],
		claims: 0,
		failReplayWrite: false,
		failCommit: false,
		warningUpdateSucceeds: true,
		staleRead: false,
		warningWhere: '',
		releaseWhere: '',
		claimExpiry: new Date('2026-09-25T00:00:00.000Z'),
	};
	let prior = Promise.resolve();
	const db = {
		delete: () => ({
			where: async (condition) => {
				state.releaseWhere = new PgDialect().sqlToQuery(condition).sql;
				if (state.slot?._claimed) state.slot = null;
			},
		}),
		update: () => ({
			set: () => ({
				where: (condition) => ({
					returning: async () => {
						state.warningWhere = new PgDialect().sqlToQuery(condition).sql;
						if (!state.warningUpdateSucceeds) return [];
						state.slot.body.warning = 'notification_delivery_failed';
						return [{ scope }];
					},
				}),
			}),
		}),
	};
	const withTransaction = async (operation) => {
		const waitFor = prior;
		let release = () => undefined;
		prior = new Promise((resolve) => {
			release = resolve;
		});
		await waitFor;
		let slot = structuredClone(state.slot);
		const rows = [...state.rows];
		const tx = {
			write: () => rows.push('created'),
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
				set: (value) => ({
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
	const source = transpileModule(readFileSync(file, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	const overrides = {
		'@/core/db': { db, idempotencyResponses },
		'@/core/db/transaction': { withTransaction },
		'@/core/guards/idempotency': {
			claimReplaySlotWithRetry: async () => {
				state.claims++;
				if (!state.slot) state.slot = { _claimed: true };
				return { won: true };
			},
		},
		'@/core/idempotency': {
			RESPONSE_REPLAY_TTL_SECONDS: 604_800,
			getCachedResponse: async () =>
				state.staleRead ? null : state.slot && !state.slot._claimed ? state.slot : null,
			readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
		},
		'@/core/infra/observability': { logApiError: () => undefined },
	};
	new Function('require', 'module', 'exports', source)(
		(name) => (name in overrides ? overrides[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const request = new Request('https://example.invalid', {
		method: 'POST',
		headers: { 'Idempotency-Key': claimKey },
	});
	const mutate = async (tx) => {
		tx.write();
		return {
			response: { status: 200, body: { id: 'comment-1', warning: null }, entityId: 'comment-1' },
			effect: 'created',
		};
	};
	return {
		state,
		run: (legacyResponse) =>
			module.exports.withAnnouncementReplay(request, scope, mutate, legacyResponse),
		persistWarning: () =>
			module.exports.persistAnnouncementReplayWarning(
				scope,
				claimKey,
				'comment-1',
				'notification_delivery_failed',
			),
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
	assert.equal(state.slot.body.warning, 'notification_delivery_failed');
	assert.match(state.warningWhere, /entityId/);
	assert.match(state.warningWhere, /expires_at/);
	assert.match(state.warningWhere, /warning/);
});

test('legacy flat response replays from cache and from locked row', async () => {
	const legacyResponse = (value) =>
		value?.announcement?.id ? { status: 200, body: value, entityId: value.announcement.id } : null;
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
