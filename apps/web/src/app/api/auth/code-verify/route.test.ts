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
