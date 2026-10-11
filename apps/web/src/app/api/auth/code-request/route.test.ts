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

test('passes otp_disabled through so the client can say there is no account', async () => {
	kit.auth.signInWithOtp = async () => ({
		error: new AuthApiError('no signups', 422, 'otp_disabled'),
	});
	const res = await call(POST, '/api/auth/code-request', { email: 'a@b.test' });
	assert.equal(res.json.code, 'otp_disabled');
});
