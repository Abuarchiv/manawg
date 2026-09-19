import { expect, test } from '@playwright/test';

test.setTimeout(300_000);

test('requires a WG member for search API results', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/search?q=Miete', {
		timeout: 120_000,
	});

	expect(response.status()).toBe(401);
	await expect(response.json()).resolves.toMatchObject({ error: 'auth_required' });
});
