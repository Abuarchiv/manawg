import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { loadClaimedResponse } from './support/claimed-response.cjs';

const webDir = path.resolve(import.meta.dirname, '..');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
const key = '11111111-1111-4111-8111-111111111111';
const calendarSubscriptions = { wgId: 'wgId', memberId: 'memberId', revokedAt: 'revokedAt' };
const idempotencyResponses = {
	scope: 'scope',
	key: 'key',
	responseBody: 'body',
	expiresAt: 'expiresAt',
};
const condition = (kind, ...parts) => ({ kind, parts });

function harness({
	subscription = null,
	pauseAudit = false,
	failReplayWrite = false,
	memberActive = true,
} = {}) {
	const state = {
		subscription,
		slot: null,
		claims: 0,
		audits: 0,
		seeds: 0,
		failReplayWrite,
		memberActive,
	};
	let auditReached;
	let releaseAudit;
	const atAudit = new Promise((resolve) => {
		auditReached = resolve;
	});
	const auditGate = new Promise((resolve) => {
		releaseAudit = resolve;
	});
	const TransactionAbort = class extends Error {
		constructor(code) {
			super(code);
			this.code = code;
		}
	};
	const withTransaction = async (operation) => {
		const draft = structuredClone({ subscription: state.subscription, slot: state.slot });
		const tx = {
			select: () => ({
				from: (table) => ({
					where: () => ({
						limit: () =>
							table === idempotencyResponses
								? {
										for: async (lock) => {
											assert.equal(lock, 'update');
											return draft.slot
												? [{ body: draft.slot.body, expiresAt: draft.slot.expiresAt }]
												: [];
										},
									}
								: {
										for: async (lock) => {
											assert.equal(lock, 'update');
											return draft.subscription ? [draft.subscription] : [];
										},
									},
					}),
				}),
			}),
			update: (table) => ({
				set: (values) => ({
					where: () => ({
						returning: async () => {
							if (table === idempotencyResponses) {
								if (state.failReplayWrite || draft.slot?.body?._claimed !== true) return [];
								draft.slot = { body: values.responseBody, expiresAt: values.expiresAt };
								return [{ scope: 'written' }];
							}
							assert.equal(table, calendarSubscriptions);
							if (!draft.subscription) return [];
							if (draft.subscription.revokedAt && !Object.hasOwn(values, 'revokedAt')) return [];
							if (draft.subscription.revokedAt && values.revokedAt !== null) return [];
							draft.subscription = { ...draft.subscription, ...values };
							return [draft.subscription];
						},
					}),
				}),
			}),
			insert: (table) => ({
				values: (values) => ({
					returning: async () => {
						assert.equal(table, calendarSubscriptions);
						assert.equal(draft.subscription, null);
						const now = new Date();
						draft.subscription = { ...values, revokedAt: null, createdAt: now, updatedAt: now };
						return [draft.subscription];
					},
				}),
			}),
		};
		const result = await operation(tx);
		state.subscription = draft.subscription;
		state.slot = draft.slot;
		return result;
	};
	const mocks = {
		'@/core/audit': {
			recordAuditEvent: async () => {
				state.audits += 1;
				auditReached();
				if (pauseAudit) await auditGate;
			},
		},
		'@/core/db': {
			db: {
				query: { calendarSubscriptions: { findFirst: async () => null } },
				delete: (table) => ({
					where: (condition) => ({
						returning: async () => {
							assert.equal(table, idempotencyResponses);
							const lease = condition.parts.find(
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
			calendarSubscriptions,
			idempotencyResponses,
		},
		'@/core/db/transaction': { TransactionAbort, withTransaction },
		'@/core/db/account-deletion': {
			lockActiveAccountMember: async (_tx, _wgId, memberId, authUserId) =>
				state.memberActive
					? { id: memberId, name: 'Mina', role: 'member', authUserId, deactivatedAt: null }
					: null,
		},
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			serverError: (code) => Response.json({ error: code }, { status: 500 }),
			tooMany: () => Response.json({ error: 'rate_limited' }, { status: 429 }),
		},
		'@/core/guards/idempotency': {
			claimReplaySlotWithRetry: async () => {
				state.claims += 1;
				if (state.slot && state.slot.expiresAt > new Date())
					return { won: false, cached: state.slot.body };
				state.slot = { body: { _claimed: true }, expiresAt: new Date(Date.now() + 60_000) };
				return { won: true };
			},
		},
		'@/core/guards/require-wg-member': {
			requireWgMember: async () => ({
				ok: true,
				wg: { id: 'wg-1' },
				member: { memberId: 'member-1', name: 'Mina' },
				authUserId: 'auth-user',
			}),
		},
		'@/core/guards/with-wg-route': { withWgRoute: (_label, handler) => handler },
		'@/core/idempotency-store': {
			RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60,
			getCachedResponse: async () =>
				state.slot?.body?._claimed ? null : (state.slot?.body ?? null),
			readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
		},
		'@/core/rate-limit': {
			checkRateLimit: async () => ({ success: true }),
			clientIpKey: () => 'ip',
			wgReadLimiter: {},
			wgWriteLimiter: {},
		},
		'@/features/events/calendar-subscription': {
			createCalendarFeedSeed: () => `seed-${++state.seeds}`,
			deriveCalendarFeedToken: (_id, seed) => `${seed}-token`,
			calendarFeedUrl: (_base, id, token) => `/feed/${id}/${token}`,
		},
		'@/shared/lib/app-url': { getAppUrl: () => 'http://localhost' },
		'drizzle-orm': {
			and: (...parts) => condition('and', ...parts),
			eq: (...parts) => condition('eq', ...parts),
			gt: (...parts) => condition('gt', ...parts),
			isNull: (...parts) => condition('isNull', ...parts),
			sql: () => condition('sql'),
		},
		'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
	};
	mocks['@/core/db/claimed-response'] = loadClaimedResponse(mocks);
	const source = readFileSync(
		path.join(webDir, 'src/app/api/wg/[code]/calendar-subscription/route.ts'),
		'utf8',
	);
	const compiled = transpileModule(source, {
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', compiled)(
		(name) => (Object.hasOwn(mocks, name) ? mocks[name] : requireFromWeb(name)),
		module,
		module.exports,
	);
	const request = (method) =>
		new Request('http://localhost/api/wg/MTE8PZAT/calendar-subscription', {
			method,
			headers: { 'idempotency-key': key },
		});
	const call = (method) => module.exports[method](request(method), { code: 'MTE8PZAT' });
	return { state, call, atAudit, releaseAudit };
}

function activeSubscription(revokedAt = null) {
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
	const { state, call, atAudit, releaseAudit } = harness({
		subscription: activeSubscription(),
		pauseAudit: true,
	});
	const first = call('PATCH');
	await atAudit;
	assert.equal(state.subscription.tokenSeed, 'seed-1');
	assert.equal(state.slot.body.status, 200);
	const duplicate = await call('PATCH');
	releaseAudit();
	const original = await first;
	assert.deepEqual(await duplicate.json(), await original.json());
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
	assert.equal(state.claims, 1);
});

test('failed replay publication rolls token rotation back', async () => {
	const { state, call } = harness({ subscription: activeSubscription(), failReplayWrite: true });
	const response = await call('PATCH');
	assert.equal(response.status, 500);
	assert.equal(state.subscription.tokenSeed, 'seed-0');
	// The rolled-back request frees its claim, so a same-key retry runs at once.
	assert.equal(state.slot, null);
	assert.equal(state.audits, 0);
	const retry = await call('PATCH');
	assert.equal(retry.status, 500);
});

test('reactivation retry does not regenerate its token', async () => {
	const { state, call } = harness({
		subscription: activeSubscription(new Date('2026-01-02T00:00:00Z')),
	});
	const first = await call('POST');
	const duplicate = await call('POST');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(state.subscription.revokedAt, null);
	assert.equal(state.seeds, 1);
	assert.equal(state.audits, 1);
});

test('revoke retry replays success after the subscription is already revoked', async () => {
	const { state, call } = harness({ subscription: activeSubscription() });
	const first = await call('DELETE');
	const duplicate = await call('DELETE');
	assert.deepEqual(await duplicate.json(), await first.json());
	assert.equal(first.status, 200);
	assert.ok(state.subscription.revokedAt);
	assert.equal(state.audits, 1);
});

test('older flat subscription response replays as HTTP 200 without rotating', async () => {
	const { state, call } = harness({ subscription: activeSubscription() });
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
	const { state, call } = harness({ subscription: activeSubscription(), memberActive: false });
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
