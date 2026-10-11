import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('updates the password of the signed-in account', async () => {
	let updated: unknown;
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
	kit.auth.updateUser = async (args) => {
		updated = args;
		return { data: {}, error: null };
	};
	const res = await call(POST, '/api/auth/password', { password: 'neues-passwort' });
	assert.deepEqual(res.json, { ok: true });
	assert.deepEqual(updated, { password: 'neues-passwort' });
});

test('answers 401 auth_required without a session and never updates', async () => {
	kit.auth.getUser = async () => ({ data: { user: null }, error: new AuthSessionMissingError() });
	kit.auth.updateUser = async () => assert.fail('must not run');
	const res = await call(POST, '/api/auth/password', { password: 'neues-passwort' });
	assert.equal(res.status, 401);
	assert.equal(res.json.code, 'auth_required');
});

test('passes same_password and weak_password through', async () => {
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
	kit.auth.updateUser = async () => ({
		data: {},
		error: new AuthApiError('same', 422, 'same_password'),
	});
	const res = await call(POST, '/api/auth/password', { password: 'gleiches' });
	assert.equal(res.status, 422);
	assert.equal(res.json.code, 'same_password');
});
