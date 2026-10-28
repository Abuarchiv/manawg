import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const originalFetch = globalThis.fetch;

let getAuthenticatedUser: typeof import('../src/core/auth/server.ts').getAuthenticatedUser;
let refreshSupabaseSession: typeof import('../src/core/auth/middleware.ts').refreshSupabaseSession;
let authFetchCalls = 0;

before(async () => {
	process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth-outage.supabase.co';
	process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
	({ getAuthenticatedUser } = await import('../src/core/auth/server.ts'));
	({ refreshSupabaseSession } = await import('../src/core/auth/middleware.ts'));
});

after(() => {
	globalThis.fetch = originalFetch;
});

const KID = 'test-signing-key';
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';
let signingKey: CryptoKeyPair;
let foreignKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

const generateKey = () =>
	crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

before(async () => {
	signingKey = await generateKey();
	foreignKey = await generateKey();
	publicJwk = { ...(await crypto.subtle.exportKey('jwk', signingKey.publicKey)), kid: KID };
});

const base64url = (input: string | ArrayBuffer) =>
	Buffer.from(input as never).toString('base64url');

/** A real ES256 session token: getClaims verifies it locally against the JWKS endpoint. */
async function accessToken(key: CryptoKeyPair, expiresAt: number): Promise<string> {
	const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID }));
	const payload = base64url(
		JSON.stringify({ sub: 'user-1', aud: 'authenticated', role: 'authenticated', exp: expiresAt }),
	);
	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key.privateKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${base64url(signature)}`;
}

async function authenticatedRequest(path = '/api/wg/mine', key = signingKey, token?: string) {
	const expiresAt = Math.floor(Date.now() / 1000) + 3600;
	const session = Buffer.from(
		JSON.stringify({
			access_token: token ?? (await accessToken(key, expiresAt)),
			refresh_token: 'test-refresh-token',
			token_type: 'bearer',
			expires_at: expiresAt,
			expires_in: 3600,
		}),
	).toString('base64url');
	return new NextRequest(`https://app.test${path}`, {
		headers: { cookie: `sb-auth-outage-auth-token=base64-${session}` },
	});
}

/** Every Auth call (JWKS discovery, token refresh, /user) answers with `status`. */
function mockAuthResponse(status: number) {
	authFetchCalls = 0;
	const body =
		status === 200
			? { keys: [publicJwk] }
			: status === 429
				? { code: 'over_request_rate_limit', message: 'Too many requests' }
				: { code: 'server_error', message: 'Auth service unavailable' };
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		authFetchCalls += 1;
		const url = String(input instanceof Request ? input.url : input);
		assert.ok(url.includes(JWKS_PATH) || url.includes('/auth/v1/'), `unexpected fetch ${url}`);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as typeof fetch;
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
		await getAuthenticatedUser(await authenticatedRequest());
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
			await authenticatedRequest('/wg/ABC123/expenses'),
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
		await getAuthenticatedUser(await authenticatedRequest());
	} catch (error) {
		authError = error;
	}
	assert.ok(authFetchCalls > 0, 'the active session must reach Supabase Auth');
	assert.equal((authError as { status?: number }).status, 429);
});

test('a cookie that is not a JWT is an invalid session, not an outage', async () => {
	mockAuthResponse(503);
	const request = await authenticatedRequest('/api/wg/mine', signingKey, 'not-a-jwt');
	assert.equal(await getAuthenticatedUser(request), null);
	assert.equal(authFetchCalls, 0, 'a malformed token never reaches Supabase Auth');
});

// Last: a successful JWKS fetch is cached process-wide, after which the outage cases above
// stop reaching the network.
test('an invalid signature still redirects to sign-in', async () => {
	mockAuthResponse(200);
	assert.equal(
		await getAuthenticatedUser(await authenticatedRequest('/api/wg/mine', foreignKey)),
		null,
	);
	assert.ok(authFetchCalls > 0, 'the signing key must be fetched from Supabase Auth');
	const response = await refreshSupabaseSession(
		await authenticatedRequest('/wg/ABC123/expenses', foreignKey),
		NextResponse.next(),
	);
	assert.equal(response.status, 307);
	assert.equal(new URL(response.headers.get('location') ?? '').pathname, '/login');

	const user = await getAuthenticatedUser(await authenticatedRequest());
	assert.deepEqual(user, { id: 'user-1' });
});
