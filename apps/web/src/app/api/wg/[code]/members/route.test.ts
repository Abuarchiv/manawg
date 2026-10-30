import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import { queryFake } from '../../../../../../tests/support/query-fake';

const future = new Date(Date.now() + 86_400_000);
const invite = { id: 'inv-1', expiresAt: future, revokedAt: null, useCount: 0, maxUses: 5 };
const member = { id: 'm-1', name: 'Mina' };
let fake = queryFake([]);
const offsets: unknown[] = [];
const listing: object = new Proxy(function listingRoot() {}, {
	get: (_target, key) => {
		if (key === 'then') return (resolve: (rows: unknown[]) => void) => resolve([]);
		if (key === 'offset') {
			return (value: unknown) => {
				offsets.push(value);
				return listing;
			};
		}
		return () => listing;
	},
});

mock.module('@/core/audit', { namedExports: { recordAuditEvent: async () => undefined } });
mock.module('@/core/db', {
	namedExports: {
		db: { query: { wgs: { findFirst: async () => ({ id: 'wg-1' }) } }, select: () => listing },
		wgInvites: {},
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
			_options: unknown,
			write: (tx: unknown) => Promise<{ status: number; body: unknown; context: unknown }>,
		) => ({ kind: 'written', ...(await write(fake.tx)) }),
	},
});
mock.module('@/core/db/transaction', {
	namedExports: {
		TransactionAbort: class extends Error {},
		withTransaction: async (work: (tx: unknown) => unknown) => work(fake.tx),
	},
});
mock.module('@/core/db/member-names', { namedExports: { releaseMemberName: async () => true } });
mock.module('@/core/guards/require-account', {
	namedExports: { requireAccount: async () => ({ ok: true, user: { id: 'user-1' } }) },
});
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg: { id: 'wg-1' }, member: { memberId: 'm-1' } }),
	},
});
mock.module('@/core/guards/share-code-miss', {
	namedExports: { shareCodeMissResponse: () => null },
});
mock.module('@/core/idempotency-store', { namedExports: { readIdempotencyKey: () => null } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () => ({ success: true }),
		clientIpKey: () => '203.0.113.9',
		wgWriteLimiter: null,
	},
});
const { GET, POST } = await import('./route');

async function join(headers: Record<string, string>) {
	fake = queryFake([
		[{ shareCode: 'ABCD2345' }],
		[],
		[invite],
		[{ total: 1, active: 1 }],
		[member],
		undefined,
	]);
	return POST(
		new NextRequest('https://app.example.test/api/wg/ABCD2345/members', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify({ name: 'Mina', inviteToken: 'a'.repeat(22) }),
		}),
		{ params: Promise.resolve({ code: 'ABCD2345' }) },
	);
}

test('the joining member row stores the request locale', async () => {
	const res = await join({ 'accept-language': 'en-GB,en;q=0.9' });
	assert.equal(res.status, 200);
	assert.equal(fake.values[0]?.locale, 'en');
});

test('a German request stores German', async () => {
	const res = await join({ 'accept-language': 'de-DE' });
	assert.equal(res.status, 200);
	assert.equal(fake.values[0]?.locale, 'de');
});

test('a huge offset is clamped to the member row cap instead of reaching the database', async () => {
	offsets.length = 0;
	const res = await GET(
		new NextRequest('https://app.example.test/api/wg/ABCD2345/members?offset=99999999999999999999'),
		{ params: Promise.resolve({ code: 'ABCD2345' }) },
	);
	assert.equal(res.status, 200);
	assert.deepEqual(offsets, [500]);
});
