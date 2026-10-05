import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const webDir = path.resolve(import.meta.dirname, '..');
const requireFromWeb = createRequire(path.join(webDir, 'package.json'));
const { ModuleKind, ScriptTarget, transpileModule } = requireFromWeb('typescript');
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
const condition = (kind, ...parts) => ({ kind, parts });

function harness({
	failAt = null,
	pauseAudit = false,
	claimBody = { _claimed: true },
	accountDeleted = false,
} = {}) {
	const state = {
		wgs: [],
		members: [],
		slot: null,
		claims: 0,
		audits: 0,
		events: [],
		failAt,
		shareCodeExhausted: false,
		accountDeleted,
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
		const draft = structuredClone({ wgs: state.wgs, members: state.members, slot: state.slot });
		const tx = {
			select: () => ({
				from: (table) => {
					assert.equal(table, idempotencyResponses);
					return {
						where: (where) => ({
							limit: () => ({
								for: async (lock) => {
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
			insert: (table) => ({
				values: (values) => ({
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
			update: (table) => {
				assert.equal(table, idempotencyResponses);
				return {
					set: (values) => ({
						where: (where) => ({
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
	const error = (code, status) => Response.json({ error: code }, { status });
	const mocks = {
		'@/core/audit': {
			recordAuditEvent: async () => {
				state.audits += 1;
				state.events.push('audit');
				auditReached();
				if (pauseAudit) await auditGate;
			},
		},
		'@/core/auth/server': { getAuthenticatedUser: async () => ({ id: 'auth-user' }) },
		'@/core/db': {
			db: {
				query: {
					wgs: { findFirst: async () => (state.shareCodeExhausted ? { id: 'existing' } : null) },
				},
			},
			idempotencyResponses,
			wgMembers,
			wgs,
		},
		'@/core/db/claimed-response': {
			releaseClaimedResponse: async (_scope, _key, leaseExpiresAt) => {
				if (
					state.slot?.body?._claimed === true &&
					state.slot.expiresAt.getTime() === leaseExpiresAt.getTime()
				) {
					state.slot = null;
				}
			},
		},
		'@/core/db/account-deletion': {
			assertAccountCanAcquireMembership: async () => {
				if (state.accountDeleted) throw new TransactionAbort('account_deletion_pending');
			},
		},
		'@/core/db/schema': { LIMITS: { NAME_MAX: 100 } },
		'@/core/db/transaction': { TransactionAbort, withTransaction },
		'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
		'@/core/http/api-errors': {
			apiError: (code, status) => error(code, status),
			badRequest: (code) => error(code, 400),
			conflict: (code) => error(code, 409),
			serverError: (code) => error(code, 500),
			tooMany: () => error('rate_limited', 429),
		},
		'@/core/guards/idempotency': {
			claimReplaySlotWithRetry: async () => {
				state.claims += 1;
				if (state.slot && state.slot.expiresAt > new Date()) {
					return { won: false, cached: state.slot.body };
				}
				state.slot = { body: claimBody, expiresAt: new Date(Date.now() + 60_000) };
				return { won: true };
			},
		},
		'@/core/guards/member-token': { deriveMemberToken: () => null },
		'@/core/idempotency-store': {
			RESPONSE_REPLAY_TTL_SECONDS: 7 * 24 * 60 * 60,
			getCachedResponse: async () =>
				state.slot?.body?._claimed ? null : (state.slot?.body ?? null),
			readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
		},
		'@/core/infra/e2e-db-down': { isE2EDbDownMode: () => false },
		'@/core/infra/observability': { logApiError: () => undefined },
		'@/core/rate-limit': {
			checkRateLimit: async () => ({ success: true }),
			clientIpKey: () => 'ip',
			rateLimitFailMode: () => 'open',
			registerLimiter: {},
		},
		'@/core/utils/share-code': {
			generateShareCode: () => 'MTE8PZAT',
			isValidShareCode: () => true,
		},
		'drizzle-orm': {
			and: (...parts) => condition('and', ...parts),
			eq: (column, value) => condition('eq', column, value),
			gt: (column, value) => condition('gt', column, value),
			sql: () => condition('sql'),
		},
		'@/shared/lib/limits': { MEMBER_NAME_MAX_LENGTH: 80, WG_NAME_MAX_LENGTH: 100 },
		'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
	};
	const source = readFileSync(path.join(webDir, 'src/app/api/wg/route.ts'), 'utf8');
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
	const request = () =>
		new Request('http://localhost/api/wg', {
			method: 'POST',
			headers: { 'idempotency-key': key },
			body: JSON.stringify({ name: 'WG', creatorName: 'Mina' }),
		});
	return { state, post: () => module.exports.POST(request()), atAudit, releaseAudit };
}

test('retry replays the committed WG response while the first request is still finishing', async () => {
	const { state, post, atAudit, releaseAudit } = harness({ pauseAudit: true });
	const first = post();
	await atAudit;
	assert.equal(state.slot.body.status, 200);
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
	assert.ok(state.slot.expiresAt.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
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
	assert.deepEqual(await response.json(), { error: 'account_deletion_pending' });
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
