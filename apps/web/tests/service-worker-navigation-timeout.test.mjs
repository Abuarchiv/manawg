import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const APP_ORIGIN = 'https://app.manawg.test';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function loadWorker({ fetch, cached }) {
	const handlers = new Map();
	const timers = [];
	const self = {
		location: { origin: APP_ORIGIN },
		addEventListener: (type, handler) => handlers.set(type, handler),
	};
	const caches = {
		match: async (key) => cached[typeof key === 'string' ? key : new URL(key.url).pathname],
		open: async () => ({ put: async () => undefined, addAll: async () => undefined }),
	};
	vm.runInNewContext(source, {
		self,
		URL,
		caches,
		fetch,
		AbortController,
		setTimeout: (fn, ms) => {
			timers.push({ fn, ms });
			return timers.length;
		},
		clearTimeout: () => undefined,
	});
	return { handlers, timers };
}

function navigate(handlers, pathname) {
	let response;
	handlers.get('fetch')({
		request: {
			method: 'GET',
			mode: 'navigate',
			url: `${APP_ORIGIN}${pathname}`,
			headers: { get: () => 'text/html' },
		},
		respondWith: (promise) => {
			response = promise;
		},
	});
	return response;
}

test('a navigation the network does not answer in time falls back to the offline page', async () => {
	const { handlers, timers } = loadWorker({
		fetch: (_request, { signal }) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => reject(new Error('aborted')));
			}),
		cached: { '/offline': 'offline-page' },
	});

	const pending = navigate(handlers, '/wg/ABCD2345/ausgaben');
	assert.equal(timers.length, 1);
	assert.equal(timers[0].ms, 8000);
	timers[0].fn();

	assert.equal(await pending, 'offline-page');
});

test('a timely answer is served as is', async () => {
	const answer = { ok: true, clone: () => answer };
	const { handlers } = loadWorker({ fetch: async () => answer, cached: {} });

	assert.equal(await navigate(handlers, '/wg/ABCD2345/ausgaben'), answer);
});
