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
		return { data: { session: { access_token: 't' } }, error: null };
	};
	const res = await call(POST, '/api/auth/code-verify', { email: 'A@B.test', token: '12345678' });
	assert.deepEqual(res.json, { sessionEstablished: true });
	assert.deepEqual(received, { email: 'a@b.test', token: '12345678', type: 'email' });
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
