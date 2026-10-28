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

test('returns the provider URL instead of redirecting the server', async () => {
	let received = {} as Captured;
	kit.auth.signInWithOAuth = async (args) => {
		received = args;
		return { data: { url: 'https://accounts.example.test/auth' }, error: null };
	};
	const res = await call(POST, '/api/auth/oauth-start', { provider: 'google', next: '/login' });
	assert.deepEqual(res.json, { url: 'https://accounts.example.test/auth' });
	assert.equal(received.provider, 'google');
	assert.equal(received.options.skipBrowserRedirect, true);
	assert.equal(received.options.redirectTo, 'https://app.example.test/auth/callback?next=%2Flogin');
});

test('only knows google', async () => {
	kit.auth.signInWithOAuth = async () => assert.fail('must not run');
	assert.equal(
		(await call(POST, '/api/auth/oauth-start', { provider: 'github', next: '/' })).status,
		400,
	);
});

test('passes provider errors through', async () => {
	kit.auth.signInWithOAuth = async () => ({
		data: {},
		error: new AuthApiError('disabled', 400, 'validation_failed'),
	});
	assert.equal(
		(await call(POST, '/api/auth/oauth-start', { provider: 'google', next: '/' })).json.code,
		'validation_failed',
	);
});
