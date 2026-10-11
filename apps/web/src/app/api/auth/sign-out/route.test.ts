import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { call, installAuthRouteMocks, kit } from '../../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { POST } = await import('./route');

const cookie =
	'sb-proj-auth-token.0=a; sb-proj-auth-token.1=b; sb-proj-auth-token-code-verifier=v; manawg_signed_in=1; other=keep';

test('signs out locally and clears every Supabase cookie and the hint', async () => {
	let scope: unknown;
	kit.auth.signOut = async (args) => {
		scope = args;
		return { error: null };
	};
	const res = await call(POST, '/api/auth/sign-out', {}, { cookie });
	assert.deepEqual(res.json, { ok: true });
	assert.deepEqual(scope, { scope: 'local' });
	const cleared = res.response.headers.getSetCookie();
	for (const name of [
		'sb-proj-auth-token.0',
		'sb-proj-auth-token.1',
		'sb-proj-auth-token-code-verifier',
		'manawg_signed_in',
	]) {
		assert.ok(
			cleared.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c)),
			`${name} must be cleared`,
		);
	}
	assert.ok(!cleared.some((c) => c.startsWith('other=')));
});

test('keeps the session when Supabase cannot be reached', async () => {
	kit.auth.signOut = async () => ({ error: new AuthRetryableFetchError('fetch failed', 0) });
	const res = await call(POST, '/api/auth/sign-out', {}, { cookie });
	assert.equal(res.status, 503);
	assert.equal(res.response.headers.getSetCookie().length, 0);
});

test('signs out every device when asked', async () => {
	let scope: unknown;
	kit.auth.signOut = async (args) => {
		scope = args;
		return { error: null };
	};
	const res = await call(POST, '/api/auth/sign-out', { everywhere: true }, { cookie });
	assert.deepEqual(res.json, { ok: true });
	assert.deepEqual(scope, { scope: 'global' });
});
