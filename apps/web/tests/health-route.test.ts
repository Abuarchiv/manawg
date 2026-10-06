import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import { assertMatchObject } from './support/match-object';

let databaseCalls = 0;

mock.module('@/core/infra/env', {
	namedExports: { checkEnv: () => ({ ok: true, missingRequired: [], degraded: [] }) },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({
			success: false,
			remaining: 0,
			reset: Date.now() + 60_000,
			limiterUnavailable: true,
		}),
		clientIpKey: () => '127.0.0.1',
		healthLimiter: null,
	},
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			execute: async () => {
				databaseCalls += 1;
			},
		},
	},
});

const route = await import('../src/app/api/health/route');

test('health reports an unavailable limiter as 503 instead of rate limiting', async () => {
	const response = await route.GET(new NextRequest('https://example.invalid/api/health'));
	assert.equal(response.status, 503);
	assertMatchObject(await response.json(), { error: 'rate_limiter_unavailable' });
	assert.notEqual(response.headers.get('retry-after'), null);
	assert.equal(databaseCalls, 0);
});
