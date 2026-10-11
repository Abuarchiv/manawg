import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');
const sessionResult = { data: { session: { access_token: 't' } }, error: null };

test('signs in and reports the established session without exposing tokens', async () => {
	let received: unknown;
	kit.auth.signInWithPassword = async (credentials) => {
		received = credentials;
		return sessionResult;
	};
	const res = await call(POST, '/api/auth/sign-in', {
		email: ' Mina@Example.test ',
		password: 'pw',
	});
	assert.equal(res.status, 200);
	assert.deepEqual(res.json, { sessionEstablished: true });
	assert.deepEqual(received, { email: 'mina@example.test', password: 'pw' });
	assert.equal(res.response.headers.get('cache-control'), 'private, no-store');
	assert.equal(kit.forwardedIp, '203.0.113.9');
});

test('passes the Supabase error code through unchanged', async () => {
	kit.auth.signInWithPassword = async () => ({
		data: { session: null },
		error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
	});
	const res = await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'pw' });
	assert.equal(res.status, 400);
	assert.deepEqual(res.json, { error: 'invalid_credentials', code: 'invalid_credentials' });
});

test('keeps rate-limit and unconfirmed statuses so the client can show its texts', async () => {
	kit.auth.signInWithPassword = async () => ({
		data: { session: null },
		error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
	});
	assert.equal(
		(await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' })).json.code,
		'email_not_confirmed',
	);
	kit.auth.signInWithPassword = async () => ({
		data: { session: null },
		error: new AuthApiError('Too many', 429, 'over_request_rate_limit'),
	});
	assert.equal(
		(await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' })).status,
		429,
	);
});

test('an unreachable Auth service is a retryable 503, not a credentials error', async () => {
	kit.auth.signInWithPassword = async () => ({
		data: { session: null },
		error: new AuthRetryableFetchError('fetch failed', 0),
	});
	const res = await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' });
	assert.equal(res.status, 503);
	assert.equal(res.json.code, 'auth_unavailable');
});

test('rejects malformed bodies before calling Supabase', async () => {
	kit.auth.signInWithPassword = async () => assert.fail('must not run');
	assert.equal(
		(await call(POST, '/api/auth/sign-in', { email: 'nope', password: 'p' })).status,
		400,
	);
	assert.equal((await call(POST, '/api/auth/sign-in', '{broken')).status, 400);
});

test('answers 429 when the attempt limiter is exhausted and 503 when it is down', async () => {
	kit.auth.signInWithPassword = async () => assert.fail('must not run');
	kit.limit = { success: false };
	assert.equal(
		(await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' })).status,
		429,
	);
	kit.limit = { success: false, limiterUnavailable: true };
	assert.equal(
		(await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' })).status,
		503,
	);
});

test('answers 503 when Supabase is not configured', async () => {
	kit.envConfigured = false;
	const res = await call(POST, '/api/auth/sign-in', { email: 'a@b.test', password: 'p' });
	assert.equal(res.status, 503);
	kit.envConfigured = true;
});
