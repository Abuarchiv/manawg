import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import { queryFake } from '../../../../tests/support/query-fake';

const freshFake = () =>
	queryFake([[{ id: 'wg-1', shareCode: 'ABCD2345', name: 'Haus' }], [{ id: 'm-1', name: 'Mina' }]]);
let fake = freshFake();
let auditDone: Promise<void> = Promise.resolve();
let shareCodeLookups = 0;

mock.module('@/core/audit', { namedExports: { recordAuditEvent: () => auditDone } });
mock.module('@/core/db', {
	namedExports: {
		db: {
			query: {
				wgs: {
					findFirst: async () => {
						shareCodeLookups += 1;
						return undefined;
					},
				},
			},
		},
		wgMembers: {},
		wgs: {},
	},
});
mock.module('@/core/db/account-deletion', {
	namedExports: { assertAccountCanAcquireMembership: async () => undefined },
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		withIdempotentWrite: async (
			options: { prepare: () => Promise<{ input: unknown }> },
			write: (
				tx: unknown,
				input: unknown,
			) => Promise<{ status: number; body: unknown; context: unknown }>,
		) => {
			const prepared = await options.prepare();
			const outcome = await write(fake.tx, prepared.input);
			return { kind: 'written', ...outcome };
		},
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort: class extends Error {},
		withTransaction: async (work: (tx: unknown) => unknown) => work(fake.tx),
	},
});
mock.module('@/core/guards/require-account', {
	namedExports: { requireAccount: async () => ({ ok: true, user: { id: 'user-1' } }) },
});
mock.module('@/core/idempotency-store', { namedExports: { readIdempotencyKey: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '203.0.113.9',
		rateLimitFailMode: () => 'closed',
		registerLimiter: null,
	},
});
const { POST } = await import('./route');

function create(headers: Record<string, string>) {
	fake = freshFake();
	return POST(
		new NextRequest('https://app.example.test/api/wg', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ name: 'Haus', creatorName: 'Mina' }),
		}),
	);
}

test('the creator row stores the request locale', async () => {
	const res = await create({ cookie: 'manawg_locale=en' });
	assert.equal(res.status, 200);
	assert.equal(fake.values[1]?.locale, 'en');
});

test('a request without a language signal stores German', async () => {
	const res = await create({});
	assert.equal(res.status, 200);
	assert.equal(fake.values.at(-1)?.locale, 'de');
});

// #1057: the invite screen waits on this response, so it must not wait on the audit row.
test('the response does not wait for the audit event', async () => {
	auditDone = new Promise(() => undefined);
	try {
		const res = await Promise.race([
			create({}),
			new Promise<'blocked'>((resolve) => setTimeout(resolve, 200, 'blocked')),
		]);
		assert.notEqual(res, 'blocked');
	} finally {
		auditDone = Promise.resolve();
	}
});

test('no share-code lookup runs before the write; the unique index retries collisions', async () => {
	shareCodeLookups = 0;
	const res = await create({});
	assert.equal(res.status, 200);
	assert.equal(shareCodeLookups, 0);
});
