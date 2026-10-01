// Vercel Preview protection (Preview lane only; CI references this file by name).
// Why: the deployment must stay unreachable without the automation bypass secret.

import { expect, test } from '@playwright/test';

const previewE2E = process.env.PREVIEW_E2E === 'true';

test.describe('protected Preview deployment', () => {
	test.skip(!previewE2E, 'runs only in the protected Preview deployment job');

	test('keeps Preview access credentials off external requests', async ({ page, baseURL }) => {
		if (!baseURL) throw new Error('Missing Preview origin');
		for (const url of [
			'https://outside-preview.invalid/probe',
			`https://child.${new URL(baseURL).hostname}/probe`,
		]) {
			let observed = false;
			let credentialSent = false;
			await page.route(url, async (route) => {
				const headers = await route.request().allHeaders();
				observed = true;
				credentialSent =
					Object.hasOwn(headers, 'x-vercel-protection-bypass') ||
					(headers.cookie ?? '').includes('_vercel_jwt');
				await route.fulfill({ body: 'ok' });
			});
			await page.goto(url);
			expect(observed).toBe(true);
			expect(credentialSent).toBe(false);
			await page.unroute(url);
		}
	});

	test('requires protection, then remains accessible with the Vercel bypass cookie', async ({
		browser,
		page,
	}) => {
		const anonymousContext = await browser.newContext({
			storageState: { cookies: [], origins: [] },
			extraHTTPHeaders: {},
		});
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

		const firstRequest = page.waitForRequest('**/api/health');
		const headerResponse = await page.goto('/api/health');
		expect(Object.hasOwn((await firstRequest).headers(), 'x-vercel-protection-bypass')).toBe(false);
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
