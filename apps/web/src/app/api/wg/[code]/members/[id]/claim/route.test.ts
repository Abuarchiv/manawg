import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import { queryFake } from '../../../../../../../../tests/support/query-fake';

const memberId = '2f6d1f0e-62f5-4a5b-9d0e-3a0b4a2d4f10';
const invite = {
	id: 'inv-1',
	expiresAt: new Date(Date.now() + 86_400_000),
	revokedAt: null,
	useCount: 0,
	maxUses: 5,
};
const claimable = { id: memberId, name: 'Mina', authUserId: null, deactivatedAt: null };
let fake = queryFake([]);

mock.module('@/core/db', {
	namedExports: {
		db: {
			query: { wgs: { findFirst: async () => ({ id: 'wg-1' }) } },
			select: () => (fake.tx.select as () => unknown)(),
		},
		wgInvites: {},
		wgMembers: {},
	},
});
mock.module('@/core/db/account-deletion', {
	namedExports: { assertAccountCanAcquireMembership: async () => undefined },
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
mock.module('@/core/guards/share-code-miss', {
	namedExports: { shareCodeMissResponse: () => null },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
const { POST } = await import('./route');

async function claim(headers: Record<string, string>) {
	fake = queryFake([[invite], [claimable], [], [{ id: memberId, name: 'Mina' }]]);
	const url = `https://app.example.test/api/wg/ABCD2345/members/${memberId}/claim?invite=${'a'.repeat(22)}`;
	return POST(new NextRequest(url, { method: 'POST', headers }), {
		params: Promise.resolve({ code: 'ABCD2345', id: memberId }),
	});
}

test('claiming a member stores the request locale next to the account', async () => {
	const res = await claim({ cookie: 'manawg_locale=en' });
	assert.equal(res.status, 200);
	assert.deepEqual(fake.sets[0], { authUserId: 'user-1', locale: 'en' });
});

test('a request without a language signal claims with German', async () => {
	const res = await claim({});
	assert.equal(res.status, 200);
	assert.equal(fake.sets[0]?.locale, 'de');
});
