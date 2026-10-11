import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type Captured,
	call,
	installAuthRouteMocks,
	kit,
} from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('mails a recovery link that returns through the callback to the reset page', async () => {
	let received = {} as Captured;
	kit.auth.resetPasswordForEmail = async (email, options) => {
		received = { email, options };
		return { error: null };
	};
	const res = await call(POST, '/api/auth/password-reset', { email: 'A@B.test' });
	assert.deepEqual(res.json, { ok: true });
	assert.equal(received.email, 'a@b.test');
	assert.equal(
		received.options.redirectTo,
		'https://app.example.test/auth/callback?next=%2Fauth%2Freset',
	);
});

test('rejects an invalid address without calling Supabase', async () => {
	kit.auth.resetPasswordForEmail = async () => assert.fail('must not run');
	assert.equal((await call(POST, '/api/auth/password-reset', { email: 'x' })).status, 400);
});
