import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';

const { bearerTokenFor } = await import('./server');

function request(path: string, method = 'GET', authorization = 'Bearer abc.def.ghi') {
	return new NextRequest(`https://app.example.test${path}`, {
		method,
		headers: { authorization },
	});
}

test('an agent token counts for the WG API, including the account-level WG routes', () => {
	assert.equal(bearerTokenFor(request('/api/wg/K7Q2M9XD/shopping', 'POST')), 'abc.def.ghi');
	assert.equal(bearerTokenFor(request('/api/wg/mine')), 'abc.def.ghi');
	assert.equal(bearerTokenFor(request('/api/wg', 'POST')), 'abc.def.ghi');
});

test('an agent token never reaches account, auth or upload routes, nor deletes a whole WG', () => {
	for (const path of ['/api/account', '/api/auth/sign-out', '/api/upload/image', '/api/wgx']) {
		assert.equal(bearerTokenFor(request(path, 'POST')), null, path);
	}
	assert.equal(bearerTokenFor(request('/api/wg/K7Q2M9XD', 'DELETE')), null);
	assert.equal(bearerTokenFor(request('/api/wg/K7Q2M9XD/shopping/1', 'DELETE')), 'abc.def.ghi');
});

test('only a well-formed bearer header is read', () => {
	for (const header of ['', 'Basic abc', 'Bearer ', 'Bearer a b', 'bearer abc']) {
		assert.equal(bearerTokenFor(request('/api/wg/mine', 'GET', header)), null, header);
	}
});
