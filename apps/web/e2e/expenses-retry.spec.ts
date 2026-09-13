import { expect, test } from '@playwright/test';

test.setTimeout(300_000);

test('requires a WG member for expenses and recurring API data', async ({ request }) => {
	const [expensesResponse, recurringResponse] = await Promise.all([
		request.get('/api/wg/MTE8PZAT/expenses', { timeout: 120_000 }),
		request.get('/api/wg/MTE8PZAT/recurring-expenses', { timeout: 120_000 }),
	]);

	expect(expensesResponse.status()).toBe(401);
	expect(recurringResponse.status()).toBe(401);
	await expect(expensesResponse.json()).resolves.toMatchObject({
		error: 'member_id_required',
	});
	await expect(recurringResponse.json()).resolves.toMatchObject({
		error: 'member_id_required',
	});
});
