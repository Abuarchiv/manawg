import { expect, test } from '@playwright/test';

test.describe('WG export API', () => {
	test.setTimeout(120_000);

	test('returns the requested CSV section instead of always exporting expenses', async ({
		request,
	}) => {
		const response = await request.get('/api/wg/MTE8PZAT/export?format=csv&section=members', {
			headers: { 'x-manawg-member-id': '7d898f9e-5ad7-4f5d-abed-8c3e99a76973' },
			timeout: 120_000,
		});

		const body = await response.text();
		expect(response.status(), body).toBe(200);
		expect(response.headers()['content-disposition']).toContain('MTE8PZAT-members.csv');
		expect(body).toContain('id,name,createdAt');
	});
});
