import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// A committed write whose response was too large to keep can never be replayed: the read must
// fail with the final `idempotency_response_unavailable` (409), never with the retryable
// `idempotency_cache_read_failed` (503) that would send an offline queue into a retry loop.

const idempotencyResponses = pgTable('idempotency_responses', {
	scope: text('scope'),
	key: text('key'),
	responseBody: jsonb('response_body'),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
});

const state = { rows: [] as Array<{ body: unknown }>, error: null as Error | null, captured: 0 };

mock.module('@/core/db', {
	namedExports: {
		idempotencyResponses,
		db: {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: async () => {
							if (state.error) throw state.error;
							return state.rows;
						},
					}),
				}),
			}),
		},
	},
});
mock.module('@/core/guards/api-auth', { namedExports: { UUID_PATTERN: /^[0-9a-f-]{36}$/i } });
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: () => {
			state.captured += 1;
		},
		logApiError: () => undefined,
	},
});

const { getCachedResponse } = await import('../src/core/idempotency-store.ts');
const { rateLimitResponse, serverError } = await import('../src/core/http/api-errors.ts');

test('a replay-unavailable row throws the final code, unwrapped', async () => {
	state.rows = [{ body: { _replayUnavailable: true } }];
	state.error = null;
	await assert.rejects(getCachedResponse('scope', 'key'), (err: unknown) => {
		assert.ok(err instanceof Error);
		assert.equal(err.message, 'idempotency_response_unavailable');
		return true;
	});
});

test('a database error stays the retryable cache-read failure', async () => {
	state.rows = [];
	state.error = new Error('connection reset');
	await assert.rejects(getCachedResponse('scope', 'key'), /idempotency_cache_read_failed/);
	state.error = null;
});

test('a pending claim and a stored response read as before', async () => {
	state.rows = [{ body: { _claimed: true } }];
	assert.equal(await getCachedResponse('scope', 'key'), null);
	state.rows = [{ body: { status: 200, body: { ok: true } } }];
	assert.deepEqual(await getCachedResponse('scope', 'key'), { status: 200, body: { ok: true } });
});

test('serverError answers an unavailable replay with a final 409', async () => {
	const response = serverError(new Error('idempotency_response_unavailable'));
	assert.equal(response.status, 409);
	assert.equal(response.headers.get('Retry-After'), null);
	assert.deepEqual(await response.json(), {
		error: 'idempotency_response_unavailable',
		code: 'idempotency_response_unavailable',
	});

	const retryable = serverError(new Error('idempotency_cache_read_failed'));
	assert.equal(retryable.status, 503);
	assert.equal(retryable.headers.get('Retry-After'), '1');
});

test('rateLimitResponse: admitted, limited, and limiter outage', async () => {
	assert.equal(rateLimitResponse({ success: true, remaining: 1, reset: Date.now() }), null);

	const limited = rateLimitResponse({ success: false, remaining: 0, reset: Date.now() });
	assert.equal(limited?.status, 429);
	assert.deepEqual(await limited?.json(), { error: 'too_many_requests' });

	const outage = rateLimitResponse({
		success: false,
		remaining: 0,
		reset: Date.now() + 2500,
		limiterUnavailable: true,
	});
	assert.equal(outage?.status, 503);
	assert.equal(outage?.headers.get('Retry-After'), '3');
	const body = (await outage?.json()) as { error: string; retryAfterMs: number };
	assert.equal(body.error, 'rate_limiter_unavailable');
	assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= 2500);
});

test('serverError answers a lock timeout, wrapped or not, with a retryable 503', async () => {
	const lockTimeout = Object.assign(new Error('canceling statement due to lock timeout'), {
		code: '55P03',
	});
	for (const err of [lockTimeout, new Error('Failed query', { cause: lockTimeout })]) {
		const response = serverError(err);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('Retry-After'), '2');
		assert.deepEqual(await response.json(), { error: 'service_unavailable', code: 'busy_retry' });
	}
	assert.equal(serverError(new Error('boom')).status, 500);
});
