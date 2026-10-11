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

test('resends the confirmation mail for the signup flow', async () => {
	let received = {} as Captured;
	kit.auth.resend = async (args) => {
		received = args;
		return { error: null };
	};
	const res = await call(POST, '/api/auth/resend', { email: 'a@b.test', next: '/neu' });
	assert.deepEqual(res.json, { ok: true });
	assert.equal(received.type, 'signup');
	assert.equal(
		received.options.emailRedirectTo,
		'https://app.example.test/auth/callback?next=%2Fneu',
	);
});

test('reports the Supabase send limit as a rate limit', async () => {
	kit.auth.resend = async () => ({
		error: new AuthApiError('limit', 429, 'over_email_send_rate_limit'),
	});
	const res = await call(POST, '/api/auth/resend', { email: 'a@b.test', next: '/' });
	assert.equal(res.status, 429);
	assert.equal(res.json.code, 'over_email_send_rate_limit');
});
