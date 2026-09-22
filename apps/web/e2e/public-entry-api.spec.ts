import { expect, test } from '@playwright/test';
import { apiFetch } from '../src/core/infra/api-client';
import { E2E_EXISTING_WG } from '../src/core/infra/e2e-db-down';

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

test('guest upload signing does not reveal whether a share code exists', async ({
	request,
	baseURL,
}) => {
	const payload = {
		purpose: 'expense',
		mimeType: 'image/png',
		fileSize: 1024,
	};

	for (const shareCode of ['MTE8PZAT', 'ZZZZZZZZ']) {
		const response = await request.post('/api/upload/sign', {
			headers: { origin: new URL(baseURL).origin },
			data: { ...payload, shareCode },
		});
		expect(response.status()).toBe(401);
		expect(await response.json()).toEqual({
			error: 'auth_required',
			code: 'auth_required',
		});
	}
});

test('fixture WG bootstrap keeps member guards and current-member metadata', async ({
	request,
	baseURL,
}) => {
	test.skip(
		process.env.E2E_FIXTURE_MODE !== 'true' || process.env.NEXT_PUBLIC_DB_DOWN !== 'true',
		'Requires the database-down fixture server.',
	);

	const code = E2E_EXISTING_WG.shareCode;
	const memberId = E2E_EXISTING_WG.member.id;
	const validHeaders = { 'x-manawg-member-id': memberId };

	const noHeader = await request.get(`/api/wg/${code}`);
	expect(noHeader.status()).toBe(200);
	const validWg = await request.get(`/api/wg/${code}`, { headers: validHeaders });
	expect(validWg.status()).toBe(200);
	expect(await noHeader.json()).toMatchObject({
		currentMember: { memberId, name: E2E_EXISTING_WG.member.name },
	});
	expect(await validWg.json()).toMatchObject({
		currentMember: { memberId, name: E2E_EXISTING_WG.member.name },
	});

	const noMemberHeader = await request.get(`/api/wg/${code}/members`);
	expect(noMemberHeader.status()).toBe(401);
	const members = await request.get(`/api/wg/${code}/members`, { headers: validHeaders });
	expect(members.status()).toBe(200);
	const invalidMembers = await request.get(`/api/wg/${code}/members`, {
		headers: { 'x-manawg-member-id': '00000000-0000-4000-8000-000000000000' },
	});
	expect(invalidMembers.status()).toBe(401);

	const previousFixtureMode = process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE;
	const previousDbDown = process.env.NEXT_PUBLIC_DB_DOWN;
	try {
		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE = 'true';
		process.env.NEXT_PUBLIC_DB_DOWN = 'true';
		const fixtureClient = await apiFetch<{ members: unknown[] }>(
			new URL(`/api/wg/${code}/members`, baseURL).href,
			{ memberId },
		);
		expect(fixtureClient.ok).toBe(true);

		process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE = 'false';
		const normalClient = await apiFetch(new URL(`/api/wg/${code}/members`, baseURL).href, {
			memberId,
		});
		expect(normalClient).toMatchObject({ ok: false, status: 401 });
	} finally {
		// Restore exactly: writing '' would leave a defined env var behind, and
		// assigning undefined would stringify to "undefined" — remove instead.
		if (previousFixtureMode === undefined) {
			Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_E2E_FIXTURE_MODE');
		} else {
			process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE = previousFixtureMode;
		}
		if (previousDbDown === undefined) {
			Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_DB_DOWN');
		} else {
			process.env.NEXT_PUBLIC_DB_DOWN = previousDbDown;
		}
	}

	const dashboard = await request.get(`/api/wg/${code}/dashboard`, { headers: validHeaders });
	expect(dashboard.status()).toBe(200);
});
