import assert from 'node:assert/strict';
import test from 'node:test';
import { authCookieOptions, sessionHintCookieOptions } from './cookie-options';

test('session cookies are HttpOnly, Secure on HTTPS and always Lax and site-wide', () => {
	assert.deepEqual(authCookieOptions(true), {
		path: '/',
		sameSite: 'lax',
		secure: true,
		httpOnly: true,
	});
	assert.deepEqual(authCookieOptions(false), {
		path: '/',
		sameSite: 'lax',
		secure: false,
		httpOnly: true,
	});
});

test('the signed-in hint cookie stays readable by scripts and lives as long as the session', () => {
	const options = sessionHintCookieOptions(true);
	assert.equal(options.httpOnly, false);
	assert.equal(options.secure, true);
	assert.equal(options.maxAge, 400 * 24 * 60 * 60);
});
