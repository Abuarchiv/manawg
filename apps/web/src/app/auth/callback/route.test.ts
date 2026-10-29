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
	const marker = async (origin: string) =>
		(await GET(new NextRequest(`${origin}/auth/callback?code=c&next=%2Fauth%2Freset`))).cookies.get(
			'manawg_password_recovery',
		);
	const secure = async (origin: string) =>
		(await marker(origin)) as unknown as { secure?: boolean };
	assert.equal((await secure('https://app.manawg.test')).secure, true);
	assert.notEqual((await secure('http://localhost:3000')).secure, true);
});
