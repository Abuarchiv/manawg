import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 'server-only' is a sentinel module that throws when imported from a client
// bundle. Tests run in a jsdom env and load both server + client code; mock it
// out so any chat-server.ts (and similar) import resolves to a no-op.
vi.mock('server-only', () => ({}));

/**
 * Node >=24 ships a native global `localStorage` gated behind
 * `--localstorage-file`. In the jsdom environment that global shadows jsdom's
 * own working implementation, so `window.localStorage` reads back undefined and
 * every suite touching storage dies on `Cannot read properties of undefined`.
 *
 * The test scripts pass `--no-experimental-webstorage` to prevent that, but a
 * bare `vitest run` (or any tool invoking vitest directly) bypasses the npm
 * script and hits it again. Installing a real Storage here when one is missing
 * makes the suite correct however it is started.
 *
 * Only fills a gap — never replaces a working implementation, so the tests that
 * deliberately break storage to assert graceful degradation still control it.
 */
if (typeof window !== 'undefined' && !window.localStorage && typeof Storage !== 'undefined') {
	const backing = new WeakMap<object, Map<string, string>>();
	const storeOf = (self: object): Map<string, string> => {
		let store = backing.get(self);
		if (!store) {
			store = new Map();
			backing.set(self, store);
		}
		return store;
	};

	// Defined ON Storage.prototype, not as own properties of the instance:
	// several suites assert graceful degradation by doing
	// `vi.spyOn(Storage.prototype, 'setItem')`, and an own method would shadow
	// that spy so the "storage is blocked" path could never be exercised.
	Object.assign(Storage.prototype, {
		getItem(this: Storage, key: string) {
			return storeOf(this).get(String(key)) ?? null;
		},
		setItem(this: Storage, key: string, value: string) {
			storeOf(this).set(String(key), String(value));
		},
		removeItem(this: Storage, key: string) {
			storeOf(this).delete(String(key));
		},
		clear(this: Storage) {
			storeOf(this).clear();
		},
		key(this: Storage, index: number) {
			return [...storeOf(this).keys()][index] ?? null;
		},
	});

	const storage: Storage = Object.create(Storage.prototype);
	Object.defineProperty(storage, 'length', {
		get(this: Storage) {
			return storeOf(this).size;
		},
	});
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		writable: true,
		value: storage,
	});
}
