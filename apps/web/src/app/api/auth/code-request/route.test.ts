import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError } from '@supabase/supabase-js';
import {
	type Captured,
	call,
	installAuthRouteMocks,
	kit,
} from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('asks for a code without creating accounts', async () => {
	let received = {} as Captured;
	kit.auth.signInWithOtp = async (args) => {
		received = args;
		return { error: null };
	};
	const res = await call(POST, '/api/auth/code-request', { email: 'A@B.test' });
	assert.deepEqual(res.json, { ok: true });
	assert.deepEqual(received, { email: 'a@b.test', options: { shouldCreateUser: false } });
});

test('answers ok for an address without an account, so existence is not revealed', async () => {
	kit.auth.signInWithOtp = async () => ({
		error: new AuthApiError('no signups', 422, 'otp_disabled'),
	});
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test' });
	assert.deepEqual(res.json, { ok: true });
});

test('registers with a name: creates the account, passes name and language, sets no password', async () => {
	let received = {} as Captured;
	kit.auth.signInWithOtp = async (args) => {
		received = args;
		return { error: null };
	};
	const res = await call(
		POST,
		'/api/auth/code-request',
		{ email: 'New@B.test', name: '  Mina  ' },
		{ cookie: 'manawg_locale=en' },
	);
	assert.deepEqual(res.json, { ok: true });
	assert.equal(received.email, 'new@b.test');
	assert.equal('password' in received, false);
	assert.deepEqual(received.options, {
		shouldCreateUser: true,
		data: { full_name: 'Mina', locale: 'en', registration: 'code' },
	});
});

test('registration answers ok for an address that already has an account', async () => {
	// Supabase mails the existing account its sign-in code and answers like it does for a new one.
	kit.auth.signInWithOtp = async () => ({ error: null });
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: 'Mina' });
	assert.deepEqual(res.json, { ok: true });
});

test('registration on an instance without signups answers like it does for an existing address', async () => {
	// Auth refuses only an unknown address, so passing the error on would reveal which addresses exist.
	kit.auth.signInWithOtp = async () => ({
		error: new AuthApiError('signups off', 422, 'signup_disabled'),
	});
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: 'Mina' });
	assert.equal(res.status, 200);
	assert.deepEqual(res.json, { ok: true });
});

test('registration still reports failures that are not about the address', async () => {
	kit.auth.signInWithOtp = async () => ({
		error: new AuthApiError('mail failed', 500, 'unexpected_failure'),
	});
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: 'Mina' });
	assert.notEqual(res.status, 200);
});

test('registration rejects an empty name and an over-long one', async () => {
	kit.auth.signInWithOtp = async () => ({ error: null });
	assert.equal(
		(await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: ' ' })).status,
		400,
	);
	assert.equal(
		(await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: 'x'.repeat(200) }))
			.status,
		400,
	);
});

test('registration is rate limited like every other code request', async () => {
	kit.limit = { success: false };
	let called = false;
	kit.auth.signInWithOtp = async () => {
		called = true;
		return { error: null };
	};
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test', name: 'Mina' });
	assert.equal(res.status, 429);
	assert.equal(called, false);
});
