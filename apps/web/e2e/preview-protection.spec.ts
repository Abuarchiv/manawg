import { expect, test } from '@playwright/test';

const previewE2E = process.env.PREVIEW_E2E === 'true';

test.describe('protected Preview deployment', () => {
	test.skip(!previewE2E, 'runs only in the protected Preview deployment job');

	test('requires protection, then remains accessible with the Vercel bypass cookie', async ({
		browser,
		page,
	}) => {
		const anonymousContext = await browser.newContext();
		try {
			const anonymousResponse = await anonymousContext.request.get(
				`${process.env.BASE_URL}/api/health`,
				{ maxRedirects: 0 },
			);
			expect(anonymousResponse.status()).not.toBe(200);
			expect(await anonymousResponse.text()).not.toContain('"status":"ok"');
		} finally {
			await anonymousContext.close();
		}

		const headerResponse = await page.goto('/api/health');
		expect(headerResponse?.status()).toBe(200);
		await expect(page.locator('body')).toContainText('"status":"ok"');

		await page.context().setExtraHTTPHeaders({});
		const cookieOnlyRequest = page.waitForRequest('**/api/health');
		const cookieOnlyResponse = await page.goto('/api/health');
		expect((await cookieOnlyRequest).headers()['x-vercel-protection-bypass']).toBeUndefined();

		expect(cookieOnlyResponse?.status()).toBe(200);
		await expect(page.locator('body')).toContainText('"status":"ok"');
	});
});
