import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

const { apiFetch, codeFromStatus } = await import('./api-client');

afterEach(() => mock.restoreAll());

function stubFetch(response: Response) {
	mock.method(globalThis, 'fetch', async () => response);
}

test('codeFromStatus names 429 and every 5xx, and keeps the status text otherwise', () => {
	assert.equal(codeFromStatus(429, 'Too Many Requests'), 'too_many_requests');
	assert.equal(codeFromStatus(500, ''), 'server_error');
	assert.equal(codeFromStatus(599, 'x'), 'server_error');
	assert.equal(codeFromStatus(400, 'Bad Request'), 'Bad Request');
	assert.equal(codeFromStatus(404, ''), '');
});

test('apiFetch gives a bodiless proxy 502 the retry code', async () => {
	stubFetch(
		new Response('<h1>Bad Gateway</h1>', {
			status: 502,
			statusText: 'Bad Gateway',
			headers: { 'content-type': 'text/html' },
		}),
	);
	assert.deepEqual(await apiFetch('/api/x'), { ok: false, status: 502, error: 'server_error' });
});

test('apiFetch gives a 504 with an empty status text the retry code', async () => {
	stubFetch(new Response('timeout', { status: 504, headers: { 'content-type': 'text/plain' } }));
	assert.deepEqual(await apiFetch('/api/x'), { ok: false, status: 504, error: 'server_error' });
});

test('apiFetch gives a bodiless 429 the rate-limit code', async () => {
	stubFetch(
		new Response('Too Many Requests', {
			status: 429,
			statusText: 'Too Many Requests',
			headers: { 'content-type': 'text/plain' },
		}),
	);
	assert.deepEqual(await apiFetch('/api/x'), {
		ok: false,
		status: 429,
		error: 'too_many_requests',
	});
});

test('apiFetch keeps a JSON error code over the status mapping', async () => {
	stubFetch(Response.json({ error: 'x' }, { status: 502 }));
	assert.deepEqual(await apiFetch('/api/x'), { ok: false, status: 502, error: 'x' });
});

test('apiFetch keeps the status text of other bodiless 4xx answers', async () => {
	stubFetch(new Response('no', { status: 400, statusText: 'Bad Request' }));
	assert.deepEqual(await apiFetch('/api/x'), { ok: false, status: 400, error: 'Bad Request' });
});
