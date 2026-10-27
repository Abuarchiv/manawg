// Security contracts that need a running server: the fixture CSP response and anonymous WG API access.
// Pure logic (CSRF origin, guards, rate limits, body reads, idempotency) lives in tests/security-*.test.ts.

import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember, skipUnlessFixtures } from './support/helpers';

test.describe('security headers', () => {
	test('local fixture HTTP response keeps the rest of the strict CSP', async ({ page }) => {
		skipUnlessFixtures();
		await setupMember(page);

		const response = await page.goto(`/wg/${FIXTURE_WG.shareCode}/putzen`, {
			waitUntil: 'domcontentloaded',
		});
		expect(response?.status()).toBe(200);

		const policy = response?.headers()['content-security-policy'] ?? '';
		expect(policy).not.toContain('upgrade-insecure-requests');
		expect(policy).toMatch(/script-src [^;]*'nonce-[^']+'/);
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("base-uri 'self'");
		expect(policy).toContain("form-action 'self'");
	});
});

test.describe('require wg member regression', () => {
	test('anonymous WG requests return auth_required before WG lookup', async ({ request }) => {
		for (const path of [
			'chat/messages',
			'dashboard',
			'expenses',
			'recurring-expenses',
			'chores',
			'absences',
		]) {
			const response = await request.get(`/api/wg/${FIXTURE_WG.shareCode}/${path}`, {
				timeout: 120_000,
			});

			expect(response.status(), path).toBe(401);
			expect(await response.json(), path).toEqual({
				error: 'auth_required',
				code: 'auth_required',
			});
		}
	});
});
