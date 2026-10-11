import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import {
	type Captured,
	call,
	installAuthRouteMocks,
	kit,
} from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('returns the link URL for the signed-in account', async () => {
	let received = {} as Captured;
	kit.auth.linkIdentity = async (args) => {
		received = args;
		return { data: { url: 'https://accounts.example.test/link' }, error: null };
	};
	const res = await call(POST, '/api/auth/identity-link', {
		provider: 'google',
		next: '/wg/ABCD2345/einstellungen',
	});
	assert.deepEqual(res.json, { url: 'https://accounts.example.test/link' });
	assert.equal(received.options.skipBrowserRedirect, true);
});

test('answers 401 auth_required without a session', async () => {
	kit.auth.linkIdentity = async () => ({ data: {}, error: new AuthSessionMissingError() });
	const res = await call(POST, '/api/auth/identity-link', { provider: 'google', next: '/' });
	assert.equal(res.status, 401);
	assert.equal(res.json.code, 'auth_required');
});

test('passes identity_already_exists through', async () => {
	kit.auth.linkIdentity = async () => ({
		data: {},
		error: new AuthApiError('exists', 422, 'identity_already_exists'),
	});
	assert.equal(
		(await call(POST, '/api/auth/identity-link', { provider: 'google', next: '/' })).json.code,
		'identity_already_exists',
	);
});
