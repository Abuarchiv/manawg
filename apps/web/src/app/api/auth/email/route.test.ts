import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

test('starts the e-mail change for the signed-in account', async () => {
	let updated: unknown;
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
	kit.auth.updateUser = async (args) => {
		updated = args;
		return { data: {}, error: null };
	};
	const res = await call(POST, '/api/auth/email', { email: 'Neu@Beispiel.test', next: '/' });
	assert.deepEqual(res.json, { ok: true });
	assert.deepEqual((updated as { email: string }).email, 'neu@beispiel.test');
});

test('answers 401 auth_required without a session and never updates', async () => {
	kit.auth.getUser = async () => ({ data: { user: null }, error: new AuthSessionMissingError() });
	kit.auth.updateUser = async () => assert.fail('must not run');
	const res = await call(POST, '/api/auth/email', { email: 'neu@beispiel.test' });
	assert.equal(res.status, 401);
	assert.equal(res.json.code, 'auth_required');
});

test('passes email_exists through', async () => {
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
	kit.auth.updateUser = async () => ({
		data: {},
		error: new AuthApiError('exists', 422, 'email_exists'),
	});
	const res = await call(POST, '/api/auth/email', { email: 'da@beispiel.test' });
	assert.equal(res.status, 422);
	assert.equal(res.json.code, 'email_exists');
});
