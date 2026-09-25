import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(relativePath, mocks, env, logs = []) {
	const source = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), 'utf8');
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const module = { exports: {} };
	new Function('require', 'module', 'exports', 'process', 'console', compiled)(
		(id) => (Object.hasOwn(mocks, id) ? mocks[id] : require(id)),
		module,
		module.exports,
		{ env },
		{ warn: () => {}, error: (...args) => logs.push(args) },
	);
	return module.exports;
}

test('transaction pools follow effective URL changes without retrying unknown commits', async () => {
	const env = { POSTGRES_URL: 'postgres://localhost/database_a' };
	const pools = [];
	let commitError = null;
	let attempts = 0;
	const connection = load('core/db/connection.ts', { './supabase-ca': {} }, env);
	const mocks = {
		'./connection': connection,
		'./schema': {},
		'./transaction-abort': {},
		pg: {
			Pool: class {
				constructor({ connectionString }) {
					this.url = connectionString;
					this.ended = false;
					pools.push(this);
				}
				on() {}
				async end() {
					this.ended = true;
				}
			},
		},
		'drizzle-orm/node-postgres': {
			drizzle: (pool) => ({
				readUrl: () => pool.url,
				transaction: async (fn) => {
					attempts += 1;
					const result = await fn({ url: pool.url });
					if (commitError) throw commitError;
					return result;
				},
			}),
		},
	};
	const { db } = load('core/db/index.ts', mocks, env);
	const { withTransaction } = load('core/db/transaction.ts', mocks, env);
	const transactionUrl = () => withTransaction((tx) => tx.url);
	assert.equal(db.readUrl(), await transactionUrl());
	env.POSTGRES_URL = 'postgres://localhost/database_b';
	assert.equal(db.readUrl(), await transactionUrl());
	assert.ok(pools[0].ended && pools[1].ended);

	env.DATABASE_URL_UNPOOLED = 'postgres://localhost/direct_a';
	assert.equal(await transactionUrl(), env.DATABASE_URL_UNPOOLED);
	env.POSTGRES_URL_NON_POOLING = 'postgres://localhost/direct_b';
	assert.equal(await transactionUrl(), env.POSTGRES_URL_NON_POOLING);
	const poolCount = pools.length;
	env.DATABASE_URL_UNPOOLED = 'postgres://localhost/ignored';
	assert.equal(await transactionUrl(), env.POSTGRES_URL_NON_POOLING);
	assert.equal(pools.length, poolCount);
	env.POSTGRES_URL_NON_POOLING = undefined;
	env.DATABASE_URL_UNPOOLED = undefined;
	assert.equal(await transactionUrl(), db.readUrl());
	env.POSTGRES_URL = undefined;
	env.DATABASE_URL = 'postgres://localhost/database_c';
	assert.equal(db.readUrl(), await transactionUrl());

	commitError = new Error('connection lost after COMMIT');
	const attemptsBefore = attempts;
	await assert.rejects(transactionUrl(), (error) => error === commitError);
	assert.equal(attempts, attemptsBefore + 1);
});

test('maintenance attempts deletion recovery when idempotency cleanup fails', async () => {
	const env = { CRON_SECRET: 'test-secret' };
	const logs = [];
	let deleteError = new Error('database unavailable');
	const recoveryCalls = [];
	let recoveryResult = { attempted: 1, completed: 0, failed: 1, pending: 1 };
	const idempotency = load(
		'core/idempotency.ts',
		{
			'@/core/db': {
				idempotencyResponses: {},
				db: {
					delete: () => ({
						where: () => ({
							returning: async () => {
								if (deleteError) throw deleteError;
								return [{ key: 'expired' }];
							},
						}),
					}),
				},
			},
			'@/core/guards/api-auth': {},
			'@/core/infra/observability': load('core/infra/observability.ts', {}, env, logs),
			'@/core/rate-limit': { createConfiguredRedis: () => null },
			'drizzle-orm': { lte: () => {} },
		},
		env,
		logs,
	);
	const route = load(
		'app/api/cron/maintenance/route.ts',
		{
			'@/core/auth/env': { hasSupabaseEnv: () => false, getSupabaseEnv: () => null },
			'@/core/auth/delete-user': { deleteAuthUser: async () => false },
			'@/core/db/account-deletion': {
				retryPendingAccountDeletions: async (deleteAuth) => {
					recoveryCalls.push(deleteAuth);
					return recoveryResult;
				},
			},
			'@/core/idempotency': idempotency,
			'@/core/infra/cron-auth': { verifyCronSecret: () => true },
			'@/core/infra/observability': load('core/infra/observability.ts', {}, env, logs),
			'next/server': { NextResponse: Response },
		},
		env,
		logs,
	);
	const request = new Request('https://example.com/api/cron/maintenance');
	const failedCleanup = await route.GET(request);
	assert.equal(failedCleanup.status, 503);
	assert.deepEqual(await failedCleanup.json(), {
		ok: false,
		purgedIdempotencyRows: null,
		accountDeletions: { ...recoveryResult, authAdminAvailable: false },
	});
	assert.equal(recoveryCalls.length, 1);
	assert.equal(recoveryCalls[0], null);
	assert.deepEqual(logs.at(-1), ['[maintenance] idempotency cleanup failed', 'Error']);
	deleteError = null;
	recoveryResult = { attempted: 1, completed: 1, failed: 0, pending: 0 };
	const response = await route.GET(request);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		ok: true,
		purgedIdempotencyRows: 1,
		accountDeletions: { ...recoveryResult, authAdminAvailable: false },
	});
	assert.equal(recoveryCalls.length, 2);
});
