import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

// Only a healthy answer may sit in a shared cache (uptime checks then skip the function for a
// few minutes); anything else must reach the caller fresh, so a cache never hides an outage.

const state = {
	limit: { success: true, limit: 60, remaining: 59, reset: 0 } as Record<string, unknown>,
	envOk: true,
	dbOk: true,
};

mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => state.limit,
		clientIpKey: () => '127.0.0.1',
		healthLimiter: {},
	},
});
mock.module('@/core/infra/env', {
	namedExports: {
		runtimeEnv: () => ({}),
		checkEnv: () => ({ ok: state.envOk, missingRequired: state.envOk ? [] : ['X'], degraded: [] }),
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => {}, captureException: () => {} },
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			execute: async () => {
				if (!state.dbOk) throw new Error('down');
				return [];
			},
		},
	},
});

const { GET } = await import('../src/app/api/health/route.ts');

function reset(): void {
	state.limit = { success: true, limit: 60, remaining: 59, reset: 0 };
	state.envOk = true;
	state.dbOk = true;
}

async function call(query = ''): Promise<Response> {
	return GET(new NextRequest(`http://localhost/api/health${query}`));
}

test('a healthy answer may be cached by the CDN for a few minutes', async () => {
	reset();
	const res = await call();
	assert.equal(res.status, 200);
	assert.equal((await res.json()).status, 'ok');
	assert.equal(res.headers.get('Cache-Control'), 'public, s-maxage=240');
});

test('a query string does not change the answer (deploy polling uses one to bypass the cache)', async () => {
	reset();
	const res = await call('?t=123');
	assert.equal(res.status, 200);
	assert.equal((await res.json()).status, 'ok');
});

test('a database outage is never cached', async () => {
	reset();
	state.dbOk = false;
	const res = await call();
	assert.equal(res.status, 503);
	assert.equal((await res.json()).status, 'degraded');
	assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('missing required configuration is never cached', async () => {
	reset();
	state.envOk = false;
	const res = await call();
	assert.equal(res.status, 503);
	assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('a rate-limited answer is never cached', async () => {
	reset();
	state.limit = { success: false, limit: 60, remaining: 0, reset: Date.now() + 30_000 };
	const res = await call();
	assert.equal(res.status, 429);
	assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('an unavailable rate limiter is never cached', async () => {
	reset();
	state.limit = {
		success: false,
		limit: 60,
		remaining: 0,
		reset: Date.now() + 30_000,
		limiterUnavailable: true,
	};
	const res = await call();
	assert.equal(res.status, 503);
	assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
