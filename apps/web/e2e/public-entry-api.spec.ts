import { expect, test } from '@playwright/test';

test('guest membership lookup ignores unrelated and PKCE cookies', async ({ request }) => {
	const anonymous = await request.get('/api/wg/mine');
	expect(anonymous.status()).toBe(401);
	expect(await anonymous.json()).toEqual({ error: 'auth_required', code: 'auth_required' });

	const verifier = 'sb-demo-auth-token-flow-release-regression-flow-code-verifier=x';
	const flowIndex = 'sb-demo-auth-token-flows-code-verifier=x';
	const withUnrelatedCookies = await request.get('/api/wg/mine', {
		headers: { cookie: `theme=dark; ${verifier}; ${flowIndex}` },
	});
	expect(withUnrelatedCookies.status()).toBe(401);
	expect(await withUnrelatedCookies.json()).toEqual({
		error: 'auth_required',
		code: 'auth_required',
	});

	if (process.env.E2E_EXPECT_MISSING_SUPABASE !== 'true') return;

	const tokenCookie = await request.get('/api/wg/mine', {
		headers: { cookie: 'sb-demo-auth-token.0=x' },
	});
	expect(tokenCookie.status()).toBe(500);

	const bearer = await request.get('/api/wg/mine', {
		headers: { authorization: 'Bearer intentionally-invalid' },
	});
	expect(bearer.status()).toBe(500);
});
