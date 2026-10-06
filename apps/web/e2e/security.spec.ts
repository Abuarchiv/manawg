// Security and HTTP contracts: CSRF/origin checks, security headers, membership guards (no 404 oracle),
// rate-limit fail-open behaviour, bounded body reads, idempotency replay and API client edge cases.
// Pure logic runs without a browser; these guard the trust boundary and must not regress silently.
import { expect, test } from '@playwright/test';
import { FIXTURE_WG, setupMember } from './_helpers';

test.describe('security headers', () => {
	test('local fixture HTTP response keeps the rest of the strict CSP', async ({ page }) => {
		test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
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
			const response = await request.get(`/api/wg/MTE8PZAT/${path}`, { timeout: 120_000 });

			expect(response.status(), path).toBe(401);
			expect(await response.json(), path).toEqual({
				error: 'auth_required',
				code: 'auth_required',
			});
		}
	});
});
