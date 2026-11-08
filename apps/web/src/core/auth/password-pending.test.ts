import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { choosePasswordHref, passwordPending } from './password-pending';

const CHOOSE = '/auth/reset?choose=1';

test('an invitation that travels through the sign-in page is kept for after the password is chosen', () => {
	assert.equal(
		choosePasswordHref('/login?next=%2Finvite%2Fabc'),
		`${CHOOSE}&next=${encodeURIComponent('/login?next=%2Finvite%2Fabc')}`,
	);
});

test('the create action on the sign-in page is kept', () => {
	assert.equal(
		choosePasswordHref('/login?action=create'),
		`${CHOOSE}&next=${encodeURIComponent('/login?action=create')}`,
	);
});

test('a sign-in page without intent, or with an unsafe or looping target, gives the bare page', () => {
	for (const next of ['/login', '/login?next=%2Flogin', '/login?next=%2F%2Fevil.com', '/', null]) {
		assert.equal(choosePasswordHref(next), CHOOSE);
	}
});

test('an ordinary page is carried along as the page to continue to', () => {
	assert.equal(choosePasswordHref('/invite/x'), `${CHOOSE}&next=%2Finvite%2Fx`);
});

function authWith(user: Record<string, unknown>): SupabaseClient['auth'] {
	return { getUser: async () => ({ data: { user } }) } as unknown as SupabaseClient['auth'];
}

const justConfirmed = () => new Date(Date.now() - 1000).toISOString();

test('an account whose password was dropped at confirmation must choose a new one', async () => {
	const auth = authWith({
		app_metadata: { password_pending: true },
		user_metadata: {},
		email_confirmed_at: justConfirmed(),
	});
	assert.equal(await passwordPending(auth), true);
});

test('an account created by a registration code has no password to choose again', async () => {
	const auth = authWith({
		app_metadata: { password_pending: true },
		user_metadata: { registration: 'code' },
		email_confirmed_at: justConfirmed(),
	});
	assert.equal(await passwordPending(auth), false);
});

test('a confirmation from long ago no longer sends the account to choose a password', async () => {
	const auth = authWith({
		app_metadata: { password_pending: true },
		user_metadata: {},
		email_confirmed_at: new Date(Date.now() - 3_600_000).toISOString(),
	});
	assert.equal(await passwordPending(auth), false);
});
