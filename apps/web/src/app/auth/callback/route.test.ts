import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js';
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

test('the sign-in page is not carried along as the page to continue to', async () => {
	signedInAs({ password_pending: true });
	const res = await callback('code=c&next=%2Flogin');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/auth/reset?choose=1');
});

test('an invitation behind the sign-in page is carried along as the page to continue to', async () => {
	signedInAs({ password_pending: true });
	const res = await callback(`code=c&next=${encodeURIComponent('/login?next=%2Finvite%2Fx')}`);
	assert.equal(
		res.headers.get('location'),
		'https://app.manawg.test/auth/reset?choose=1&next=%2Flogin%3Fnext%3D%252Finvite%252Fx',
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

test('logs a failed code exchange only when GoTrue is down or answers 5xx', async () => {
	const exchangeFails = async (error: unknown, mode: 'return' | 'throw' = 'return') => {
		kit.logged = [];
		kit.auth.exchangeCodeForSession = async () => {
			if (mode === 'throw') throw error;
			return { data: { session: null }, error };
		};
		const res = await callback('code=c');
		assert.match(res.headers.get('location') ?? '', /\/login\?error=auth_callback/);
	};
	await exchangeFails(new AuthRetryableFetchError('fetch failed', 0));
	assert.deepEqual(kit.logged, ['[auth/callback] exchange failed']);
	await exchangeFails(new AuthApiError('unexpected', 500, 'unexpected_failure'));
	assert.deepEqual(kit.logged, ['[auth/callback] exchange failed']);
	await exchangeFails(new Error('boom'), 'throw');
	assert.deepEqual(kit.logged, ['[auth/callback] exchange threw']);
	await exchangeFails(new AuthApiError('expired', 400, 'flow_state_expired'));
	assert.deepEqual(kit.logged, []);
	// A non-JSON error body with a status outside the retryable list (an HTML 403 from a proxy)
	// yields an AuthUnknownError without a status.
	await exchangeFails(
		new AuthUnknownError('Unexpected token <', new SyntaxError("Unexpected token '<'")),
	);
	assert.deepEqual(kit.logged, ['[auth/callback] exchange failed']);
});

test('the callback leaves the funnel marker only for a new account or a real sign-in', async () => {
	const session = (createdAt: Date) => {
		kit.auth.exchangeCodeForSession = async () => ({
			data: {
				session: { user: { id: 'u1', app_metadata: {}, created_at: createdAt.toISOString() } },
			},
			error: null,
		});
		kit.auth.getUser = async () => ({
			data: { user: { id: 'u1', app_metadata: {}, created_at: createdAt.toISOString() } },
			error: null,
		});
	};
	const marker = async (query: string, signedInCookie = false) =>
		(
			await GET(
				new NextRequest(`https://app.manawg.test/auth/callback?${query}`, {
					headers: signedInCookie ? { cookie: 'manawg_signed_in=1' } : {},
				}),
			)
		).cookies.get('manawg_funnel')?.value;
	session(new Date());
	assert.equal(await marker('code=c'), 'signup_confirmed');
	session(new Date(Date.now() - 24 * 60 * 60 * 1000));
	assert.equal(await marker('code=c'), 'login_completed');
	assert.equal(await marker('code=c', true), undefined);
	assert.equal(await marker('code=c&next=%2Fauth%2Freset'), undefined);
});
