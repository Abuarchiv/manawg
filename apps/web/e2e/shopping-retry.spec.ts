import { expect, test } from '@playwright/test';

test.setTimeout(240_000);

test('requires a WG member for shopping API data', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/shopping', {
		timeout: 120_000,
	});

	expect(response.status()).toBe(401);
	await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
});
