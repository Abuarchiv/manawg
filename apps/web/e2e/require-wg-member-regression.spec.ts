import { expect, test } from '@playwright/test';

test('anonymous WG requests return auth_required before WG lookup', async ({ request }) => {
	const response = await request.get('/api/wg/MTE8PZAT/chat/messages');

	expect(response.status()).toBe(401);
	expect(await response.json()).toEqual({
		error: 'auth_required',
		code: 'auth_required',
	});
});
