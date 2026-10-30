import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

let selects = 0;
let rateLimit: Record<string, unknown> = { success: true };

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: {
		db: {
			select: () => {
				selects += 1;
				throw new Error('db.select must not run for an out-of-range window');
			},
		},
		wgEvents: {},
	},
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		withIdempotentWrite: async (options: {
			prepare: () => Promise<{ stop: unknown } | { input: unknown }>;
		}) => {
			const prepared = await options.prepare();
			return 'stop' in prepared ? { kind: 'stopped', response: prepared.stop } : undefined;
		},
	},
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort: class extends Error {} },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg: { id: 'wg-1' }, member: { memberId: 'm-1' } }),
	},
});
mock.module('@/core/idempotency-store', {
	namedExports: { readIdempotencyKey: () => null, setReplayWarning: () => undefined },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/notifications/notification-dispatch', {
	namedExports: { dispatchNotificationSafely: async () => ({ warning: null }) },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => rateLimit,
		clientIpKey: () => '203.0.113.9',
		wgReadLimiter: null,
		wgWriteLimiter: null,
	},
});
const { GET, POST } = await import('./route');

async function list(query: string) {
	selects = 0;
	const res = await GET(
		new NextRequest(`https://app.example.test/api/wg/ABCD2345/events?${query}`),
		{ params: Promise.resolve({ code: 'ABCD2345' }) },
	);
	return { status: res.status, body: await res.json() };
}

test('a from date before the supported years answers from_invalid', async () => {
	const res = await list('from=-271821-04-20T00:00:00.000Z&to=2030-01-01T00:00:00.000Z');
	assert.equal(res.status, 400);
	assert.deepEqual(res.body, { error: 'from_invalid' });
	assert.equal(selects, 0);
});

test('a to date after the supported years answers to_invalid', async () => {
	const res = await list('from=2030-01-01T00:00:00.000Z&to=%2B275760-09-13T00:00:00.000Z');
	assert.equal(res.status, 400);
	assert.deepEqual(res.body, { error: 'to_invalid' });
	assert.equal(selects, 0);
});

const create = (extra: Record<string, unknown> = {}) =>
	POST(
		new NextRequest('https://app.example.test/api/wg/ABCD2345/events', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ title: 'Party', startsAt: '2030-01-01T18:00:00.000Z', ...extra }),
		}),
		{ params: Promise.resolve({ code: 'ABCD2345' }) },
	);

test('POST rejects an RRULE component that would otherwise be silently dropped', async () => {
	rateLimit = { success: true };
	const res = await create({ recurrence: 'FREQ=DAILY;BYDAY=MO;COUNT=2' });
	assert.equal(res.status, 400);
	assert.deepEqual(await res.json(), { error: 'recurrence_invalid' });
});

test('POST answers 503 with Retry-After when the rate limiter is down', async () => {
	rateLimit = {
		success: false,
		remaining: 0,
		reset: Date.now() + 60_000,
		limiterUnavailable: true,
	};
	const res = await create();
	assert.equal(res.status, 503);
	assert.deepEqual(Object.keys(await res.json()).sort(), ['error', 'retryAfterMs']);
	assert.ok(Number(res.headers.get('Retry-After')) >= 1);
});

test('POST answers 429 rate_limited when the member exceeds the limit', async () => {
	rateLimit = { success: false, remaining: 0, reset: Date.now() + 60_000 };
	const res = await create();
	assert.equal(res.status, 429);
	assert.equal((await res.json()).error, 'rate_limited');
});
