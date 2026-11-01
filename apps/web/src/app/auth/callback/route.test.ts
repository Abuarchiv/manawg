import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { installAuthRouteMocks, kit } from '../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { GET } = await import('./route');

const callback = (query: string) =>
	GET(new NextRequest(`https://app.manawg.test/auth/callback?${query}`));

test('the first of two e-mail change links returns to where the change started', async () => {
	const res = await callback('message=Confirmation+link+accepted&next=%2Fwg%2FABC%2Fsettings');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/wg/ABC/settings');
	assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('a callback without code that reports an error still lands on the error page', async () => {
	for (const query of ['error=access_denied&next=%2F', 'message=x&error_description=y', '']) {
		const location = (await callback(query)).headers.get('location') ?? '';
		assert.match(location, /\/login\?error=auth_callback/);
	}
});

test('the password-recovery marker is Secure only when the callback is served over https', async () => {
	kit.auth.exchangeCodeForSession = async () => ({
		data: { session: { user: { id: 'u1' } } },
		error: null,
	});
	kit.auth.getUser = async () => ({ data: { user: { id: 'u1' } }, error: null });
	const marker = async (origin: string) =>
		(await GET(new NextRequest(`${origin}/auth/callback?code=c&next=%2Fauth%2Freset`))).cookies.get(
			'manawg_password_recovery',
		);
	const secure = async (origin: string) =>
		(await marker(origin)) as unknown as { secure?: boolean };
	assert.equal((await secure('https://app.manawg.test')).secure, true);
	assert.notEqual((await secure('http://localhost:3000')).secure, true);
});

const signedInAs = (appMetadata: Record<string, unknown>, confirmedAt = new Date()) => {
	kit.auth.exchangeCodeForSession = async () => ({
		data: { session: { user: { id: 'u1', app_metadata: {} } } },
		error: null,
	});
	// The session's own copy of the user is stale after a confirmation; the server's is current.
	kit.auth.getUser = async () => ({
		data: {
			user: { id: 'u1', app_metadata: appMetadata, email_confirmed_at: confirmedAt.toISOString() },
		},
		error: null,
	});
};

test('an account whose password was dropped at confirmation goes on to choose one', async () => {
	signedInAs({ password_pending: true });
	const res = await callback('code=c');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/auth/reset?choose=1');
	assert.equal(res.cookies.get('manawg_password_recovery')?.value, 'u1');
});

test('the page to continue to after choosing a password is carried along', async () => {
	signedInAs({ password_pending: true });
	const res = await callback('code=c&next=%2Finvite%2Fx');
	assert.equal(
		res.headers.get('location'),
		'https://app.manawg.test/auth/reset?choose=1&next=%2Finvite%2Fx',
	);
});

test('an account that skipped choosing a password is not sent back on later sign-ins', async () => {
	signedInAs({ password_pending: true }, new Date(Date.now() - 3_600_000));
	const res = await callback('code=c&next=%2Fwg%2FABC');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/wg/ABC');
});

test('a confirmed account with a password continues to the requested page', async () => {
	signedInAs({ provider: 'email' });
	const res = await callback('code=c&next=%2Fwg%2FABC');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/wg/ABC');
	assert.equal(res.cookies.get('manawg_password_recovery'), undefined);
});
