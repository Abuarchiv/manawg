import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reloadOnStaleChunk } from './stale-chunk';

test('offline chunk failures preserve the page and allow recovery once online', () => {
	const descriptors = new Map(
		['window', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
	);
	const storage = new Map<string, string>();
	let reloads = 0;
	const navigator = { onLine: false };
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			location: { href: 'https://example.test/wg/test/expenses', reload: () => reloads++ },
			sessionStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => storage.set(key, value),
			},
		},
	});
	try {
		const error = new Error('Loading chunk failed');
		assert.equal(reloadOnStaleChunk(error), false);
		assert.equal(reloads, 0);
		assert.equal(storage.size, 0);
		navigator.onLine = true;
		assert.equal(reloadOnStaleChunk(new Error('Unrelated failure')), false);
		assert.equal(reloadOnStaleChunk(error), true);
		assert.equal(reloadOnStaleChunk(error), false);
		assert.equal(reloads, 1);
	} finally {
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
});
