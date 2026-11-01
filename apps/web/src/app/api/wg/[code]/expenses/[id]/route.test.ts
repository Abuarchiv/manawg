import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Body validation runs before authentication, so a 401 from the guard means the body was accepted.
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({
			ok: false,
			response: Response.json({ error: 'auth_reached' }, { status: 401 }),
		}),
	},
});

const { PATCH } = await import('./route');

const EXPENSE_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const OVER_CAP_CENTS = 100_000_001;

async function patch(body: unknown): Promise<string> {
	const res = await PATCH(
		new Request('https://example.invalid/api', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT', id: EXPENSE_ID }) } as never,
	);
	return `${res.status} ${((await res.json()) as { error: string }).error}`;
}

test('PATCH rejects a new amount sent without splits', async () => {
	assert.equal(await patch({ amountCents: 500 }), '400 splits_required_with_amount');
});

test('PATCH rejects an amount above the cap', async () => {
	const splits = [{ debtorMemberId: MEMBER_ID, amountCents: OVER_CAP_CENTS }];
	assert.equal(await patch({ amountCents: OVER_CAP_CENTS, splits }), '400 amount_invalid');
});

test('PATCH rejects a blank or over-long description', async () => {
	assert.equal(await patch({ description: '   ' }), '400 description_invalid');
	assert.equal(await patch({ description: 'x'.repeat(201) }), '400 description_invalid');
});

test('PATCH accepts a description at the length cap', async () => {
	assert.equal(await patch({ description: 'x'.repeat(200) }), '401 auth_reached');
});
