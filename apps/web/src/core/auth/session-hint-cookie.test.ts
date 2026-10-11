import assert from 'node:assert/strict';
import test from 'node:test';
import { NextResponse } from 'next/server';
import { applySessionHint, isAuthTokenCookie } from './session-hint-cookie';

function hintAfter(writes: { name: string; value: string }[]): string[] {
	const response = NextResponse.next();
	applySessionHint(response.cookies, writes, true);
	return response.headers.getSetCookie();
}

test('storing session cookies sets a script-readable hint, chunked or not', () => {
	for (const name of ['sb-proj-auth-token', 'sb-proj-auth-token.0']) {
		const [hint] = hintAfter([{ name, value: 'x' }]);
		assert.match(hint ?? '', /^manawg_signed_in=1;/);
		assert.doesNotMatch(hint ?? '', /HttpOnly/i);
		assert.match(hint ?? '', /Max-Age=34560000/);
	}
});

test('removing every session cookie clears the hint, a shrunk chunk list keeps it', () => {
	const [cleared] = hintAfter([
		{ name: 'sb-proj-auth-token.0', value: '' },
		{ name: 'sb-proj-auth-token.1', value: '' },
	]);
	assert.match(cleared ?? '', /^manawg_signed_in=;.*Max-Age=0/i);
	const [kept] = hintAfter([
		{ name: 'sb-proj-auth-token.0', value: 'x' },
		{ name: 'sb-proj-auth-token.1', value: '' },
	]);
	assert.match(kept ?? '', /^manawg_signed_in=1;/);
});

test('the PKCE verifier and unrelated cookies never touch the hint', () => {
	assert.deepEqual(hintAfter([{ name: 'sb-proj-auth-token-code-verifier', value: 'v' }]), []);
	assert.deepEqual(hintAfter([{ name: 'theme', value: 'dark' }]), []);
	assert.equal(isAuthTokenCookie('sb-proj-auth-token-code-verifier'), false);
});
