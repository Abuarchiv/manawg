import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { installAuthRouteMocks } from '../../../../tests/support/auth-route-kit';

installAuthRouteMocks();
const { GET } = await import('./route');

const callback = (query: string) =>
	GET(new NextRequest(`https://app.manawg.test/auth/callback?${query}`));

test('the first of two e-mail change links returns to where the change started', async () => {
	const res = await callback('message=Confirmation+link+accepted&next=%2Fwg%2FABC%2Feinstellungen');
	assert.equal(res.headers.get('location'), 'https://app.manawg.test/wg/ABC/einstellungen');
	assert.equal(res.headers.get('cache-control'), 'private, no-store');
});

test('a callback without code that reports an error still lands on the error page', async () => {
	for (const query of ['error=access_denied&next=%2F', 'message=x&error_description=y', '']) {
		const location = (await callback(query)).headers.get('location') ?? '';
		assert.match(location, /\/neu\?error=auth_callback/);
	}
});
