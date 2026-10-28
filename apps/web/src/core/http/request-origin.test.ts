import assert from 'node:assert/strict';
import test from 'node:test';
import { requestOrigin } from './request-origin';

const request = (url: string, headers: Record<string, string> = {}) => ({
	url,
	headers: new Headers(headers),
});

test('the forwarded host and protocol name the public origin behind a proxy', () => {
	assert.equal(
		requestOrigin(
			request('http://0.0.0.0:3000/auth/callback', {
				'x-forwarded-host': 'wg.example.com',
				'x-forwarded-proto': 'https',
			}),
		),
		'https://wg.example.com',
	);
	assert.equal(
		requestOrigin(request('http://0.0.0.0:3000/', { 'x-forwarded-host': 'localhost:8080' })),
		'http://localhost:8080',
	);
});

test('without forwarding headers or with broken ones the request URL decides', () => {
	assert.equal(requestOrigin(request('https://app.manawg.com/x')), 'https://app.manawg.com');
	assert.equal(
		requestOrigin(
			request('https://app.manawg.com/x', {
				'x-forwarded-host': 'bad host',
				'x-forwarded-proto': 'javascript',
			}),
		),
		'https://app.manawg.com',
	);
});
