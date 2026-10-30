import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const CALLER = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const THIRD = '55555555-5555-4555-8555-555555555555';

const state = { writes: 0 };

mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: true,
			wg: { id: 'wg' },
			member: { memberId: CALLER, name: 'Anna' },
		}),
	},
});
mock.module('@/core/db/idempotent-write', {
	namedExports: {
		responseCodec: () => ({}),
		withIdempotentWrite: async () => {
			state.writes += 1;
			return { kind: 'stopped', response: Response.json({ ok: true }) };
		},
	},
});
mock.module('@/features/expenses/server/expense-payments', {
	namedExports: { withExpensePaymentLock: async () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), wgWriteLimiter: {} },
});

const { POST } = await import('./route');

const post = (fromMemberId: string, toMemberId: string) =>
	POST(
		new Request('https://example.invalid/api/wg/MTE8PZAT/payments/manual', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ fromMemberId, toMemberId, currency: 'EUR', expectedNetCents: 500 }),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);

test('a member who is neither payer nor receiver cannot record a cash payment between two others', async () => {
	state.writes = 0;
	const response = await post(OTHER, THIRD);
	assert.equal(response.status, 403);
	assert.equal(state.writes, 0);
});

test('either side of the pair may record the payment', async () => {
	for (const [from, to] of [
		[CALLER, OTHER],
		[OTHER, CALLER],
	]) {
		state.writes = 0;
		const response = await post(from as string, to as string);
		assert.equal(response.status, 200);
		assert.equal(state.writes, 1);
	}
});
