// Settlement endpoints answer errors with a private, no-store cache policy.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, skipUnlessDbDown } from './support/helpers';

const memberA = '11111111-1111-4111-8111-111111111111';
const memberB = '22222222-2222-4222-8222-222222222222';

test.describe('settlement HTTP cache policy', () => {
	test('sets no-store on an invalid share-code preamble response', async ({ request }) => {
		const response = await request.get(
			`/api/wg/not-a-code/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
		);

		expect(response.status()).toBe(400);
		expect(response.headers()['cache-control']).toBe('private, no-store');
		await expect(response.json()).resolves.toMatchObject({ error: 'invalid_share_code' });
	});

	test('sets no-store on a withWgRoute authentication rejection', async ({ request }) => {
		skipUnlessDbDown();

		const response = await request.get(
			`/api/wg/${FIXTURE_WG.shareCode}/expenses/settle-batch?fromMemberId=${memberA}&toMemberId=${memberB}`,
			{ headers: { 'x-manawg-expected-member-id': FIXTURE_WG.memberId } },
		);

		expect(response.status()).toBe(401);
		expect(response.headers()['cache-control']).toBe('private, no-store');
		await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
	});
});
