import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const originalFetch = globalThis.fetch;

let getAuthenticatedUser: typeof import('@/core/auth/server').getAuthenticatedUser;
let refreshSupabaseSession: typeof import('@/core/auth/middleware').refreshSupabaseSession;
let authFetchCalls = 0;

before(async () => {
	process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth-outage.supabase.co';
	process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
	({ getAuthenticatedUser } = await import('@/core/auth/server'));
	({ refreshSupabaseSession } = await import('@/core/auth/middleware'));
});

after(() => {
	globalThis.fetch = originalFetch;
});

function authenticatedRequest(path = '/api/wg/mine') {
	const session = Buffer.from(
		JSON.stringify({
			access_token: 'test-access-token',
			refresh_token: 'test-refresh-token',
			token_type: 'bearer',
			expires_at: Math.floor(Date.now() / 1000) + 3600,
			expires_in: 3600,
		}),
	).toString('base64url');
	return new NextRequest(`https://app.test${path}`, {
		headers: { cookie: `sb-auth-outage-auth-token=base64-${session}` },
	});
}

function mockAuthResponse(status: number) {
	authFetchCalls = 0;
	const body =
		status === 401
			? { code: 'bad_jwt', message: 'Invalid JWT' }
			: status === 429
				? { code: 'over_request_rate_limit', message: 'Too many requests' }
				: { code: 'server_error', message: 'Auth service unavailable' };
	globalThis.fetch = async () => {
		authFetchCalls += 1;
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	};
}

function middlewareResponse() {
	const response = NextResponse.next({
		request: { headers: new Headers({ 'x-nonce': 'request-nonce' }) },
	});
	response.headers.set('Content-Security-Policy', "script-src 'nonce-response-nonce'");
	response.cookies.set('auth-refresh', 'refreshed-token');
	return response;
}

test('transient Supabase Auth failures propagate instead of becoming an unauthenticated user', async () => {
	mockAuthResponse(503);
	let authError: unknown;
	try {
		await getAuthenticatedUser(authenticatedRequest());
	} catch (error) {
		authError = error;
	}
	assert.ok(authFetchCalls > 0, 'the active session must reach Supabase Auth');
	assert.ok(isAuthRetryableFetchError(authError), 'the retryable Auth failure must propagate');
});

test('temporary Auth failures keep WG page headers and cookies for the retry boundary', async () => {
	for (const status of [503, 429]) {
		mockAuthResponse(status);
		const response = middlewareResponse();
		const result = await refreshSupabaseSession(
			authenticatedRequest('/wg/ABC123/ausgaben'),
			response,
		);

		assert.ok(authFetchCalls > 0, 'the active session must reach Supabase Auth');
		assert.strictEqual(result, response);
		assert.equal(result.headers.get('location'), null);
		assert.equal(result.headers.get('x-middleware-request-x-nonce'), 'request-nonce');
		assert.equal(
			result.headers.get('content-security-policy'),
			"script-src 'nonce-response-nonce'",
		);
		assert.equal(result.cookies.get('auth-refresh')?.value, 'refreshed-token');
	}
});

test('an upstream Auth rate limit propagates instead of becoming an unauthenticated user', async () => {
	mockAuthResponse(429);
	let authError: unknown;
	try {
		await getAuthenticatedUser(authenticatedRequest());
	} catch (error) {
		authError = error;
	}
	assert.ok(authFetchCalls > 0, 'the active session must reach Supabase Auth');
	assert.ok(authError instanceof Error);
	assert.equal(Reflect.get(authError, 'status'), 429);
});

test('an invalid session still redirects to sign-in', async () => {
	mockAuthResponse(401);
	assert.equal(await getAuthenticatedUser(authenticatedRequest()), null);
	const response = await refreshSupabaseSession(
		authenticatedRequest('/wg/ABC123/ausgaben'),
		NextResponse.next(),
	);

	assert.ok(authFetchCalls > 0, 'the active session must reach Supabase Auth');
	assert.equal(response.status, 307);
	assert.equal(new URL(String(response.headers.get('location'))).pathname, '/neu');
});
