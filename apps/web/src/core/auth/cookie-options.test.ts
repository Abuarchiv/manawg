import assert from 'node:assert/strict';
import test from 'node:test';
import { authCookieOptions } from './cookie-options';

test('session cookies are Secure on HTTPS and always Lax and site-wide', () => {
	assert.deepEqual(authCookieOptions(true), { path: '/', sameSite: 'lax', secure: true });
	assert.deepEqual(authCookieOptions(false), { path: '/', sameSite: 'lax', secure: false });
});
