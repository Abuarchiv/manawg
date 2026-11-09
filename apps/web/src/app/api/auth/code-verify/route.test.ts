import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('verifies the mailed code as an e-mail OTP', async () => {
	let received: unknown;
	kit.auth.verifyOtp = async (args) => {
		received = args;
		return { data: { session: { access_token: 't', user: { id: 'u1' } } }, error: null };
	};
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1', app_metadata: {} } }, error: null });
	const res = await call(POST, '/api/auth/code-verify', { email: 'A@B.test', token: '12345678' });
	assert.deepEqual(res.json, { sessionEstablished: true, passwordPending: false });
	assert.deepEqual(received, { email: 'a@b.test', token: '12345678', type: 'email' });
});

test('a code that confirmed the address marks the account as needing a password', async () => {
	kit.auth.verifyOtp = async () => ({
		data: { session: { access_token: 't', user: { id: 'u1' } } },
		error: null,
	});
	kit.auth.getUser = async () => ({
		data: {
			user: {
				id: 'u1',
				app_metadata: { password_pending: true },
				email_confirmed_at: new Date().toISOString(),
			},
		},
		error: null,
	});
	const res = await call(POST, '/api/auth/code-verify', { email: 'a@b.test', token: '12345678' });
	assert.deepEqual(res.json, { sessionEstablished: true, passwordPending: true });
	assert.equal(res.response.cookies.get('manawg_password_recovery')?.value, 'u1');
});

test('passes otp_expired through and refuses non-numeric codes', async () => {
	kit.auth.verifyOtp = async () => ({
		data: {},
		error: new AuthApiError('expired', 403, 'otp_expired'),
	});
	const expired = await call(POST, '/api/auth/code-verify', {
		email: 'a@b.test',
		token: '12345678',
	});
	assert.equal(expired.status, 403);
	assert.equal(expired.json.code, 'otp_expired');
	kit.auth.verifyOtp = async () => assert.fail('must not run');
	assert.equal(
		(await call(POST, '/api/auth/code-verify', { email: 'a@b.test', token: 'abc' })).status,
		400,
	);
});

test('the name of the registration form replaces one a stranger stored first, only for a new account', async () => {
	const updates: unknown[] = [];
	kit.auth.verifyOtp = async () => ({
		data: { session: { access_token: 't', user: { id: 'u1' } } },
		error: null,
	});
	kit.auth.updateUser = async (args) => {
		updates.push(args);
		return { data: {}, error: null };
	};
	const account = (confirmedAgoMs: number, registration?: string) => ({
		data: {
			user: {
				id: 'u1',
				app_metadata: {},
				user_metadata: { full_name: 'Squatter', registration },
				email_confirmed_at: new Date(Date.now() - confirmedAgoMs).toISOString(),
			},
		},
		error: null,
	});
	const body = { email: 'a@b.test', token: '12345678', name: 'Mina' };
	kit.auth.getUser = async () => account(1000, 'code');
	await call(POST, '/api/auth/code-verify', body);
	assert.deepEqual(updates, [{ data: { full_name: 'Mina' } }]);
	// A stranger's password-path registration has no mark but is renamed the same way.
	updates.length = 0;
	kit.auth.getUser = async () => account(1000);
	await call(POST, '/api/auth/code-verify', body);
	assert.deepEqual(updates, [{ data: { full_name: 'Mina' } }]);
	// An account that existed before is signed in without touching its name.
	updates.length = 0;
	kit.auth.getUser = async () => account(30 * 86_400_000, 'code');
	await call(POST, '/api/auth/code-verify', body);
	assert.deepEqual(updates, []);
});
