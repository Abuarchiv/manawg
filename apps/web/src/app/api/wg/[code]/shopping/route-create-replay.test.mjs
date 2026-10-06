import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import {
	loadClaimedResponse,
	loadIdempotentWrite,
	loadParseBody,
} from '../../../../../../tests/support/claimed-response.cjs';

const requireFromWeb = createRequire(path.join(process.cwd(), 'package.json'));
const directory = path.dirname(fileURLToPath(import.meta.url));
const wgId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const idemKey = '55555555-5555-4555-8555-555555555555';
const shoppingTable = { name: 'shopping_items' };
const idempotencyTable = {
	scope: 'scope',
	key: 'key',
	responseBody: 'responseBody',
	expiresAt: 'expiresAt',
};
const PLACEHOLDER = '{"_claimed":true}';

function transpile(file) {
	return transpileModule(readFileSync(file, 'utf8'), {
		compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
	}).outputText;
}

const routeSource = transpile(path.join(directory, 'route.ts'));
const mutationSource = transpile(
	path.join(process.cwd(), 'src/features/shopping/shopping-mutation.ts'),
);

function evaluate(source, overrides) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', source)(
		(name) => {
			if (name in overrides) return overrides[name];
			if (name.startsWith('@/')) {
				return new Proxy({}, { get: () => async () => undefined });
			}
			return requireFromWeb(name);
		},
		module,
		module.exports,
	);
	return module.exports;
}

// The claim row and its predicates, evaluated the way Postgres would.
function claimMatches(slot, condition) {
	if (!condition) return true;
	const [op, ...args] = condition;
	if (op === 'and') return args.every((part) => claimMatches(slot, part));
	if (op === 'eq') {
		const value = slot[args[0]];
		return value instanceof Date ? value.getTime() === args[1]?.getTime() : value === args[1];
	}
	if (op === 'sql' && args[0].includes(`= '${PLACEHOLDER}'::jsonb`)) {
		return JSON.stringify(slot.responseBody) === PLACEHOLDER;
	}
	if (op === 'sql' && args[0].includes('> now()')) return slot.expiresAt > new Date();
	throw new Error(`unsupported predicate ${op}`);
}


class TransactionAbort extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}

/**
 * Every `post()` is its own server process sharing one database.
 */
function harness() {
	const state = {
		slot: null,
		items: [],
		failInsert: false,
		reclaimOnRollback: false,
		stall: null,
	};
	const withTransaction = async (operation) => {
		if (state.stall) {
			const { reached, released } = state.stall;
			state.stall = null;
			reached();
			await released;
		}
		const snapshot = { slot: state.slot && { ...state.slot }, items: [...state.items] };
		const tx = {
			select: () => ({
				from: (table) => ({
					where: (condition) => ({
						limit: () => ({
							for: async (lock) => {
								assert.equal(table, idempotencyTable);
								assert.equal(lock, 'update');
								return state.slot && claimMatches(state.slot, condition)
									? [{ body: state.slot.responseBody, expiresAt: state.slot.expiresAt }]
									: [];
							},
						}),
					}),
				}),
			}),
			insert: (table) => ({
				values: (values) => ({
					returning: async () => {
						assert.equal(table, shoppingTable);
						if (state.failInsert) throw new Error('connection reset');
						const item = {
							id: `item-${state.items.length + 1}`,
							createdAt: new Date(),
							...values,
						};
						state.items.push(item);
						return [item];
					},
				}),
			}),
			update: (table) => ({
				set: (values) => ({
					where: (condition) => ({
						returning: async () => {
							assert.equal(table, idempotencyTable);
							if (!state.slot || !claimMatches(state.slot, condition)) return [];
							// jsonb keeps only what JSON can express, dates become strings.
							state.slot = {
								...state.slot,
								responseBody: JSON.parse(JSON.stringify(values.responseBody)),
								expiresAt: values.expiresAt,
							};
							return [{ scope: state.slot.scope }];
						},
					}),
				}),
			}),
		};
		try {
			return await operation(tx);
		} catch (err) {
			state.slot = snapshot.slot;
			state.items = snapshot.items;
			if (state.reclaimOnRollback) {
				state.slot = { ...state.slot, expiresAt: new Date(Date.now() + 20 * 60_000) };
			}
			throw err;
		}
	};
	const db = {
		delete: (table) => ({
			where: (condition) => ({
				returning: async () => {
					assert.equal(table, idempotencyTable);
					if (!state.slot || !claimMatches(state.slot, condition)) return [];
					state.slot = null;
					return [{ scope: 'released' }];
				},
			}),
		}),
	};
	const cachedBody = () =>
		state.slot &&
		state.slot.expiresAt > new Date() &&
		JSON.stringify(state.slot.responseBody) !== PLACEHOLDER
			? state.slot.responseBody
			: null;
	const drizzle = {
		and: (...parts) => ['and', ...parts],
		asc: (column) => ['asc', column],
		desc: (column) => ['desc', column],
		eq: (...parts) => ['eq', ...parts],
		isNotNull: (column) => ['isNotNull', column],
		isNull: (column) => ['isNull', column],
		sql: (strings, ...values) => ['sql', strings.join('?'), ...values],
	};
	const coreDb = { db, idempotencyResponses: idempotencyTable, shoppingItems: shoppingTable };
	const claimedResponse = loadClaimedResponse({
		'@/core/db': coreDb,
		'@/core/db/transaction': { TransactionAbort },
		'drizzle-orm': drizzle,
	});
	const json = (code, status) => Response.json({ error: code }, { status });
	const post = (body) => {
		const mutation = evaluate(mutationSource, {
			'@/core/db': coreDb,
			'@/core/db/claimed-response': claimedResponse,
			'@/core/db/transaction-abort': { TransactionAbort },
			'next/server': { NextResponse: Response },
		});
		const routeMocks = {
			'@/core/db': coreDb,
			'@/core/db/transaction': { TransactionAbort, withTransaction },
			'@/core/db/claimed-response': claimedResponse,
			'@/core/guards/replay-slot': {
				claimReplaySlot: async (scope, key) => {
					const cached = cachedBody();
					if (cached) return { won: false, cached };
					if (state.slot && state.slot.expiresAt > new Date()) {
						throw new Error('idempotency_response_pending');
					}
					state.slot = {
						scope,
						key,
						responseBody: { _claimed: true },
						expiresAt: new Date(Date.now() + 15 * 60_000),
					};
					return { won: true };
				},
			},
			'@/core/guards/require-wg-member': {
				requireWgMember: async () => ({
					ok: true,
					wg: { id: wgId },
					member: { memberId, name: 'Mina' },
				}),
			},
			'@/core/guards/with-wg-route': {
				withWgRoute: (_name, handler) => (req) => handler(req, { code: 'MTE8PZAT' }),
			},
			'@/core/http/api-errors': {
				badRequest: (code) => json(code, 400),
				conflict: (code) => json(code, 409),
				serverError: (code) => json(code, 500),
				tooMany: () => json('too_many', 429),
			},
			'@/core/http/read-json': { readJsonLimited: (req) => req.json() },
			'@/core/idempotency-store': {
				getCachedResponse: async () => cachedBody(),
				readIdempotencyKey: (req) => req.headers.get('idempotency-key'),
				setReplayWarning: async (_scope, _key, _target, warning) => {
					state.slot.responseBody.body.warning = warning;
					return true;
				},
			},
			'@/core/notifications/notification-dispatch': {
				dispatchNotificationSafely: async () => ({ warning: null }),
			},
			'@/core/rate-limit': { checkRateLimit: async () => ({ success: true }) },
			'@/features/shopping/shopping-duplicate': { isOpenShoppingItemDuplicate: () => false },
			'@/features/shopping/shopping-mutation': mutation,
			'drizzle-orm': drizzle,
			'next/server': { NextResponse: Response },
		};
		routeMocks['@/core/db/idempotent-write'] = loadIdempotentWrite(routeMocks);
		routeMocks['@/core/http/parse-body'] = loadParseBody(routeMocks);
		const route = evaluate(routeSource, routeMocks);
		return route.POST(
			new Request('https://example.invalid/api/wg/MTE8PZAT/shopping', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': idemKey },
				body: JSON.stringify(body),
			}),
		);
	};
	const stallNextTransaction = () => {
		let reached;
		let release;
		const atTransaction = new Promise((resolve) => {
			reached = resolve;
		});
		const released = new Promise((resolve) => {
			release = resolve;
		});
		state.stall = { reached, released };
		return { atTransaction, release };
	};
	return { state, post, stallNextTransaction };
}

test('a create stalled past its lease replays the request that took its key over', async () => {
	const { state, post, stallNextTransaction } = harness();
	const stalled = stallNextTransaction();
	const late = post({ name: 'Kaffee', bought: true });
	await stalled.atTransaction;
	// The lease runs out while the first request stalls; a retry reclaims the key.
	state.slot.expiresAt = new Date(Date.now() - 1_000);

	const retry = await post({ name: 'Kaffee', bought: true });
	assert.equal(retry.status, 200);
	const retryBody = await retry.json();
	assert.equal(retryBody.item.name, 'Kaffee');
	assert.ok(retryBody.item.boughtAt, 'a bought item is not caught by the open-name index');

	stalled.release();
	const lateResponse = await late;
	assert.equal(lateResponse.status, 200);
	assert.deepEqual(await lateResponse.json(), retryBody);
	assert.equal(state.items.length, 1);
});

test('a create stalled past its lease writes once when the reclaiming request has not locked yet', async () => {
	const { state, post, stallNextTransaction } = harness();
	const stalled = stallNextTransaction();
	const late = post({ name: 'Kaffee', bought: true });
	await stalled.atTransaction;
	// Another request reclaimed the key with a fresh lease but has not reached its transaction.
	state.slot.expiresAt = new Date(Date.now() + 15 * 60_000);

	stalled.release();
	const lateResponse = await late;
	assert.equal(lateResponse.status, 200);
	const reclaiming = await post({ name: 'Kaffee', bought: true });
	assert.deepEqual(await reclaiming.json(), await lateResponse.json());
	assert.equal(state.items.length, 1);
});

test('a rolled-back create frees its claim so the same key runs again at once', async () => {
	const { state, post } = harness();
	state.failInsert = true;
	const failed = await post({ name: 'Milch' });
	assert.equal(failed.status, 500);
	assert.deepEqual(await failed.json(), { error: 'idempotency_response_pending' });
	assert.equal(state.slot, null);

	state.failInsert = false;
	const retry = await post({ name: 'Milch' });
	assert.equal(retry.status, 200);
	assert.equal(state.items.length, 1);
});

test('a rolled-back create keeps a claim another request took over', async () => {
	const { state, post } = harness();
	state.failInsert = true;
	state.reclaimOnRollback = true;
	const failed = await post({ name: 'Milch' });
	assert.equal(failed.status, 500);
	assert.deepEqual(state.slot.responseBody, { _claimed: true });
	assert.equal(state.items.length, 0);
});
