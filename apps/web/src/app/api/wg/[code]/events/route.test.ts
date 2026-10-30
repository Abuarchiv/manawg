import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

let selects = 0;

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
	namedExports: { responseCodec: () => ({}), withIdempotentWrite: async () => undefined },
});
mock.module('@/core/db/transaction', {
	namedExports: { TransactionAbort: class extends Error {} },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: { requireWgMember: async () => ({ ok: true, wg: { id: 'wg-1' } }) },
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
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '203.0.113.9',
		wgReadLimiter: null,
		wgWriteLimiter: null,
	},
});
const { GET } = await import('./route');

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
