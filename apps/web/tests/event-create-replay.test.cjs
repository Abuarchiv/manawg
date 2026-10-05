const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { ModuleKind, ScriptTarget, transpileModule } = require('typescript');

const webRoot = path.resolve(__dirname, '..');
const requireFromWeb = createRequire(path.join(webRoot, 'package.json'));
const { jsonb, pgTable, text, timestamp } = requireFromWeb('drizzle-orm/pg-core');
const { PgDialect } = requireFromWeb('drizzle-orm/pg-core');
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

function loadTs(relativePath, mocks = {}) {
	const compiled = transpileModule(readFileSync(path.join(webRoot, 'src', relativePath), 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	return module.exports;
}

// The real field schemas run, so the route is exercised with its actual validation.
function loadEventSchemas() {
	return loadTs('features/events/event-schemas.ts', {
		'@/features/events/event-limits': loadTs('features/events/event-limits.ts'),
	});
}

function harness() {
	const state = {
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
	const dialect = new PgDialect();
	let transactionTail = Promise.resolve();
	const withTransaction = async (operation) => {
		const previous = transactionTail;
		let unlock = () => undefined;
		transactionTail = new Promise((resolve) => {
			unlock = resolve;
		});
		await previous;
		const draft = structuredClone({ slot: state.slot, events: state.events });
		const tx = {
			select: () => ({
				from: () => ({
					where: (condition) => ({
						limit: () => ({
							for: async (lock) => {
								assert.equal(lock, 'update');
								state.claimWhere = dialect.sqlToQuery(condition).sql;
								return draft.slot
									? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }]
									: [];
							},
						}),
					}),
				}),
			}),
			insert: (table) => ({
				values: (values) => ({
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
			update: (table) => ({
				set: (values) => ({
					where: (condition) => ({
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
			if (state.replaceClaimOnRollback) {
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
		delete: (table) => ({
			where: async (condition) => {
				assert.equal(table, idempotencyResponses);
				const query = dialect.sqlToQuery(condition);
				state.releaseWhere = query.sql;
				const lease = Date.parse(query.params[2]);
				if (
					state.slot &&
					Object.keys(state.slot.body).length === 1 &&
					state.slot.body._claimed === true &&
					lease === state.slot.expiresAt.getTime()
				) {
					state.slot = null;
					state.releases += 1;
				}
			},
		}),
		update: (table) => ({
			set: (values) => ({
				where: (condition) => ({
					returning: async () => {
						assert.equal(table, idempotencyResponses);
						state.warningWhere = dialect.sqlToQuery(condition).sql;
						assert.match(dialect.sqlToQuery(values.responseBody).sql, /jsonb_set/);
						if (
							state.slot?.body.body?.event?.id !== state.events[0]?.id ||
							state.slot.body.body.warning !== null
						)
							return [];
						state.slot.body.body.warning = state.warning;
						return [{ scope: 'claimed' }];
					},
				}),
			}),
		}),
	};
	class TransactionAbort extends Error {
		constructor(code) {
			super(code);
			this.code = code;
		}
	}
	const mocks = {
		'@/core/audit': {
			recordAuditEvent: async () => {
				assert.equal(state.events.length, 1, 'audit runs after commit');
				if (state.failAudit) throw new Error('audit_failed');
				state.audits += 1;
			},
		},
		'@/core/db': { db, idempotencyResponses, wgEvents },
		'@/core/db/transaction': { TransactionAbort, withTransaction },
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			badRequest: (code) => Response.json({ error: code }, { status: 400 }),
			serverError: (code) => Response.json({ error: code }, { status: 500 }),
			tooMany: (code) => Response.json({ error: code }, { status: 429 }),
		},
		'@/core/guards/idempotency': {
			claimReplaySlotWithRetry: async () => {
				state.claimAttempts += 1;
				if (state.claimResult) return state.claimResult;
				if (!state.slot) {
					state.slot = { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
				}
				return { won: true };
			},
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: wgId, name: 'WG', shareCode: 'ABCDEFGH' },
				member: { memberId, name: 'Mina' },
			}),
		},
		'@/core/guards/with-wg-route': {
			withWgRoute:
				(_name, handler) =>
				async (...args) => {
					try {
						return await handler(...args);
					} catch {
						return Response.json({ error: 'server_error' }, { status: 500 });
					}
				},
		},
		'@/core/idempotency-store': {
			RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60,
			getCachedResponse: async () => state.cachedResponse,
			readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
		},
		'@/core/notifications/notification-dispatch': {
			dispatchNotificationSafely: async () => {
				assert.equal(state.events.length, 1, 'notification runs after commit');
				state.notifications += 1;
				return { warning: state.warning };
			},
		},
		'@/core/rate-limit': {
			checkRateLimit: async () => ({ success: true }),
			clientIpKey: () => 'ip',
			wgReadLimiter: {},
			wgWriteLimiter: {},
		},
		'@/features/events/event-reminder-window': {
			buildEventsWindowFilter: () => undefined,
			withEventWindowCandidates: async () => undefined,
		},
		'@/features/events/event-schemas': loadEventSchemas(),
		'@/features/events/events': {
			formatRecurrenceRule: () => '',
			parseRecurrenceRule: () => null,
			serializeWgEvent: (row) => ({
				id: row.id,
				title: row.title,
				startsAt: row.startsAt.toISOString(),
			}),
		},
		'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
	};
	const compiled = transpileModule(
		readFileSync(path.join(webRoot, 'src/app/api/wg/[code]/events/route.ts'), 'utf8'),
		{
			compilerOptions: {
				module: ModuleKind.CommonJS,
				target: ScriptTarget.ES2022,
				esModuleInterop: true,
			},
		},
	).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const post = () =>
		module.exports.POST(
			new Request('http://localhost/api/wg/ABCDEFGH/events', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': key },
				body: JSON.stringify({ title: 'Planung', startsAt: '2026-09-25T20:00:00.000Z' }),
			}),
			{ code: 'ABCDEFGH' },
		);
	return { state, post };
}

test('legacy response envelopes replay their original status and body at every read path', async () => {
	const storedResponses = [
		{ status: 200, body: { event: { id: 'existing-event' }, warning: null } },
		{ status: 429, body: { error: 'rate_limited' } },
		{ status: 500, body: { error: 'insert_failed' } },
	];
	for (const legacy of storedResponses) {
		const assertReplay = async (response) => {
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
	assert.equal(state.slot.body.status, retry.status);
	assert.deepEqual(await retry.json(), state.slot.body.body);
	assert.equal(state.slot.body.body.event.id, state.events[0].id);
	assert.ok(state.slot.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
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
	assert.deepEqual(state.slot.body, { _claimed: true });
});

test('post-commit side-effect failure retains the completed response', async () => {
	const { state, post } = harness();
	state.failAudit = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.events.length, 1);
	assert.equal(state.slot.body.body.event.id, state.events[0].id);
	assert.equal(state.releases, 0);
});

test('rollback release cannot delete a newer claim lease', async () => {
	const { state, post } = harness();
	state.failBaseWrite = true;
	state.replaceClaimOnRollback = true;
	const response = await post();
	assert.equal(response.status, 500);
	assert.equal(state.releases, 0);
	assert.deepEqual(state.slot.body, { _claimed: true });
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
	state.slot.body = { _claimed: true, unexpected: true };
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
	assert.equal(state.slot.body.body.warning, state.warning);
	assert.match(state.warningWhere, /response_body.*body.*event.*id/);
	assert.match(state.warningWhere, /response_body.*body.*warning/);
});
