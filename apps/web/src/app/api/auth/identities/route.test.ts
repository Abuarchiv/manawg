import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { GET } = await import('./route');

test('describes the account: e-mail, password, Google and the display name', async () => {
	kit.auth.getUser = async () => ({
		data: {
			user: {
				email: 'mina@example.test',
				identities: [{ provider: 'email' }, { provider: 'google' }],
				user_metadata: { full_name: '  Mina Muster  ' },
			},
		},
		error: null,
	});
	const res = await call(GET, '/api/auth/identities');
	assert.deepEqual(res.json, {
		email: 'mina@example.test',
		hasPassword: true,
		hasGoogle: true,
		name: 'Mina Muster',
	});
});

test('a Google-only account has no password and falls back to the given name', async () => {
	kit.auth.getUser = async () => ({
		data: {
			user: {
				email: 'g@example.test',
				identities: [{ provider: 'google' }],
				user_metadata: { given_name: 'Gerd' },
			},
		},
		error: null,
	});
	const res = await call(GET, '/api/auth/identities');
	assert.equal(res.json.hasPassword, false);
	assert.equal(res.json.name, 'Gerd');
});

test('answers 401 auth_required when signed out', async () => {
	kit.auth.getUser = async () => ({ data: { user: null }, error: new AuthSessionMissingError() });
	const res = await call(GET, '/api/auth/identities');
	assert.equal(res.status, 401);
	assert.equal(res.json.code, 'auth_required');
});
