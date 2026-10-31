import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Real client.ts and push-subscribe.ts run against a recording fake of the network
// and the browser's push subscription; the events array keeps their order.

type Event = {
	type: string;
	url?: string;
	init?: { method?: string; body?: string; memberId?: string; signal?: AbortSignal } | undefined;
};

const current = {
	events: [] as Event[],
	serverAvailable: true,
	signOutGate: null as Promise<{ ok: true; data: { ok: true } }> | null,
	signOutStarted: null as (() => void) | null,
};

mock.module('@/core/infra/api-client', {
	namedExports: {
		anySignal: (signals: readonly AbortSignal[]) => AbortSignal.any([...signals]),
		noteSessionExpiry: () => {},
		readApiErrorCode: async () => '',
		REQUEST_TIMEOUT_MS: 15_000,
		apiFetch: async (url: string, init?: Event['init']) => {
			if (url === '/api/auth/sign-out') {
				current.events.push({ type: 'sign-out', url, init });
				current.signOutStarted?.();
				if (!current.signOutGate || !init?.signal) {
					return (await current.signOutGate) ?? { ok: true, data: { ok: true } };
				}
				return Promise.race([
					current.signOutGate,
					new Promise<{ ok: false; status: number; error: string }>((resolve) => {
						init.signal?.addEventListener(
							'abort',
							() => resolve({ ok: false, status: 0, error: 'network_error' }),
							{ once: true },
						);
					}),
				]);
			}
			current.events.push({ type: 'server-unsubscribe', url, init });
			return current.serverAvailable
				? { ok: true, data: { ok: true } }
				: { ok: false, status: 503, error: 'server_error' };
		},
	},
});
mock.module('@/core/auth/local-account', {
	namedExports: {
		getLocalAccount: () => {
			try {
				return globalThis.localStorage?.getItem('manawg_account') || null;
			} catch {
				return null;
			}
		},
	},
});
mock.module('@/core/offline/offline-images', {
	namedExports: { clearPendingImages: async () => true },
});
const queue = { unsent: 0, synced: [] as string[] };
mock.module('@/core/offline/offline-client', {
	namedExports: {
		readOfflineQueue: () =>
			queue.unsent > 0 ? [{ shareCode: 'ABCD2345', memberId: 'member-a' }] : [],
		syncOfflineActions: async (code: string) => {
			queue.synced.push(code);
			return 0;
		},
		countOfflineActions: () => queue.unsent,
	},
});
const client = await import('./client');

function harness({ serverAvailable = true, unsubscribeResult = true } = {}) {
	const events: Event[] = [];
	current.events = events;
	current.serverAvailable = serverAvailable;
	current.signOutGate = null;
	current.signOutStarted = null;
	let subscriptionActive = true;
	const endpoint = 'https://push.example.test/browser-endpoint';
	const subscription = {
		endpoint,
		unsubscribe: async () => {
			events.push({ type: 'local-unsubscribe' });
			if (unsubscribeResult) subscriptionActive = false;
			return unsubscribeResult;
		},
	};
	const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			serviceWorker: {
				getRegistration: async () => ({
					pushManager: { getSubscription: async () => subscription },
				}),
			},
		},
	});
	return {
		client,
		events,
		endpoint,
		isSubscriptionActive: () => subscriptionActive,
		cleanup: () => {
			if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
			else Reflect.deleteProperty(globalThis, 'navigator');
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function replaceLocalStorage(
	initial: Record<string, string> = {
		manawg_account: 'account-b',
		'manawg:scope-b': 'kept',
	},
) {
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const removed: string[] = [];
	const store: Record<string, unknown> = { ...initial };
	store.getItem = (key: string) => (typeof store[key] === 'string' ? (store[key] as string) : null);
	store.removeItem = (key: string) => {
		removed.push(key);
		delete store[key];
	};
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
	return {
		removed,
		store,
		restore() {
			if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
			else Reflect.deleteProperty(globalThis, 'localStorage');
		},
	};
}

function replaceStorageEventTarget() {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const target = new EventTarget();
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	return {
		target,
		restore() {
			if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
			else Reflect.deleteProperty(globalThis, 'window');
		},
	};
}

test('shared logout retires this browser endpoint before clearing its local subscription and auth', async () => {
	const state = harness();
	try {
		const result = await state.client.signOutSocialAccount([
			{ code: 'ABCD2345', memberId: 'member-a' },
			{ code: 'BCDE2345', memberId: 'member-b' },
		]);
		const serverCleanups = state.events.filter((event) => event.type === 'server-unsubscribe');
		assert.equal(serverCleanups.length, 2);
		assert.equal(serverCleanups[0]?.url, '/api/wg/ABCD2345/notifications');
		assert.equal(serverCleanups[0]?.init?.method, 'POST');
		assert.deepEqual(JSON.parse(serverCleanups[0]?.init?.body as string), {
			action: 'push_unsubscribe',
			endpoint: state.endpoint,
		});
		assert.equal(serverCleanups[0]?.init?.memberId, 'member-a');
		assert.equal(Object.hasOwn(serverCleanups[0]?.init ?? {}, 'memberToken'), false);
		assert.equal(serverCleanups[1]?.url, '/api/wg/BCDE2345/notifications');
		assert.equal(JSON.parse(serverCleanups[1]?.init?.body as string).endpoint, state.endpoint);
		assert.equal(serverCleanups[1]?.init?.memberId, 'member-b');
		assert.equal(state.isSubscriptionActive(), false);
		assert.deepEqual(result, { pushCleanup: 'unsubscribed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		state.cleanup();
	}
});

test('logout still unsubscribes locally and signs out when the server is offline', async () => {
	const state = harness({ serverAvailable: false });
	try {
		const result = await state.client.signOutSocialAccount([
			{ code: 'ABCD2345', memberId: 'member-a' },
		]);
		assert.equal(state.isSubscriptionActive(), false);
		assert.deepEqual(result, { pushCleanup: 'unsubscribed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		state.cleanup();
	}
});

test('logout reports when browser unsubscribe failed but still clears the auth session', async () => {
	const state = harness({ unsubscribeResult: false });
	try {
		const result = await state.client.signOutSocialAccount([
			{ code: 'ABCD2345', memberId: 'member-a' },
		]);
		assert.deepEqual(result, { pushCleanup: 'failed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
		assert.equal(state.isSubscriptionActive(), true);
	} finally {
		state.cleanup();
	}
});

test('logout with unsent actions asks first and keeps the session when declined', async () => {
	const state = harness();
	queue.unsent = 2;
	queue.synced = [];
	try {
		const asked: number[] = [];
		const declined = await state.client.signOutSocialAccount([], {
			confirmDiscard: async (count) => {
				asked.push(count);
				return false;
			},
		});
		assert.deepEqual(declined, { pushCleanup: 'none', cancelled: true });
		assert.deepEqual(asked, [2]);
		assert.deepEqual(queue.synced, ['ABCD2345']);
		assert.equal(
			state.events.some((event) => event.type === 'sign-out'),
			false,
		);
		const accepted = await state.client.signOutSocialAccount([], {
			confirmDiscard: async () => true,
		});
		assert.deepEqual(accepted, { pushCleanup: 'unsubscribed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		queue.unsent = 0;
		state.cleanup();
	}
});

test('logout does not ask when the queue is empty', async () => {
	const state = harness();
	try {
		const result = await state.client.signOutSocialAccount([], {
			confirmDiscard: async () => assert.fail('must not ask'),
		});
		assert.equal(result.cancelled, undefined);
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		state.cleanup();
	}
});

test('logout wipes account-bound browser data but keeps the theme', async () => {
	const store = new Map([
		['manawg:offline-actions', '[]'],
		['manawg:draft:ABCD2345:m:expense', '{}'],
		['manawg_account', 'user-a'],
		['manawg-theme', 'dark'],
	]);
	const deleted: string[] = [];
	const names = ['localStorage', 'caches'];
	const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
	const storage = new Proxy(
		{
			getItem: (key: string) => store.get(key) ?? null,
			removeItem: (key: string) => store.delete(key),
		},
		{
			ownKeys: () => [...store.keys()],
			getOwnPropertyDescriptor: (_, key) =>
				store.has(key as string) ? { enumerable: true, configurable: true, value: 1 } : undefined,
		},
	);
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			keys: async () => ['manawg-app-v4-shell', 'other'],
			delete: async (key: string) => deleted.push(`cache:${key}`),
		},
	});
	const state = harness();
	Object.assign(navigator, {
		clearAppBadge: async () => void deleted.push('app-badge'),
	});
	try {
		const result = await state.client.signOutSocialAccount();
		assert.deepEqual(result, { pushCleanup: 'unsubscribed' });
		assert.deepEqual([...store.keys()], ['manawg-theme']);
		assert.deepEqual(deleted.sort(), ['app-badge', 'cache:manawg-app-v4-shell']);
	} finally {
		state.cleanup();
		names.forEach((name, i) => {
			if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
});

test('logout stops when the account changes during async confirmation', async () => {
	const state = harness();
	const storage = replaceLocalStorage();
	const confirmation = deferred<boolean>();
	const asked = deferred<void>();
	storage.store.manawg_account = 'account-a';
	queue.unsent = 2;
	queue.synced = [];
	try {
		const pending = state.client.signOutSocialAccount([], {
			confirmDiscard: async () => {
				asked.resolve();
				return confirmation.promise;
			},
		});
		await asked.promise;
		storage.store.manawg_account = 'account-b';
		confirmation.resolve(true);

		assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
		assert.equal(
			state.events.some((event) => event.type === 'sign-out'),
			false,
		);
		assert.deepEqual(storage.removed, []);
	} finally {
		queue.unsent = 0;
		queue.synced = [];
		storage.restore();
		state.cleanup();
	}
});

test('logout stops when the account changes during push subscription inspection', async () => {
	const storage = replaceLocalStorage();
	try {
		for (const stage of ['registration', 'subscription'] as const) {
			const state = harness();
			const registrationGate = deferred<ServiceWorkerRegistration | undefined>();
			const subscriptionGate = deferred<PushSubscription | null>();
			const registrationStarted = deferred<void>();
			const subscriptionStarted = deferred<void>();
			let subscriptionInspections = 0;
			let unsubscribeCalls = 0;
			const subscription = {
				endpoint: 'https://push.example.test/account-a',
				unsubscribe: async () => {
					unsubscribeCalls += 1;
					return true;
				},
			} as unknown as PushSubscription;
			const registration = {
				pushManager: {
					getSubscription: async () => {
						subscriptionInspections += 1;
						subscriptionStarted.resolve();
						return stage === 'subscription' ? subscriptionGate.promise : subscription;
					},
				},
			} as unknown as ServiceWorkerRegistration;
			Object.defineProperty(globalThis, 'navigator', {
				configurable: true,
				value: {
					serviceWorker: {
						getRegistration: async () => {
							registrationStarted.resolve();
							return stage === 'registration' ? registrationGate.promise : registration;
						},
					},
				},
			});
			storage.store.manawg_account = 'account-a';
			try {
				const pending = state.client.signOutSocialAccount([
					{ code: 'ABCD2345', memberId: 'member-a' },
				]);
				if (stage === 'registration') {
					await registrationStarted.promise;
					storage.store.manawg_account = 'account-b';
					registrationGate.resolve(registration);
				} else {
					await subscriptionStarted.promise;
					storage.store.manawg_account = 'account-b';
					subscriptionGate.resolve(subscription);
				}

				assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
				assert.deepEqual(state.events, []);
				assert.equal(unsubscribeCalls, 0);
				assert.deepEqual(storage.removed, []);
				assert.equal(subscriptionInspections, stage === 'registration' ? 0 : 1);
			} finally {
				state.cleanup();
			}
		}
	} finally {
		storage.restore();
	}
});

test('logout does not clear the new account after a delayed sign-out response', async () => {
	const state = harness();
	const storage = replaceLocalStorage();
	const signOutStarted = deferred<void>();
	const signOutResponse = deferred<{ ok: true; data: { ok: true } }>();
	storage.store.manawg_account = 'account-a';
	current.signOutGate = signOutResponse.promise;
	current.signOutStarted = () => signOutStarted.resolve();
	try {
		const pending = state.client.signOutSocialAccount();
		await signOutStarted.promise;
		storage.store.manawg_account = 'account-b';
		signOutResponse.resolve({ ok: true, data: { ok: true } });

		assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
		assert.deepEqual(storage.removed, []);
	} finally {
		storage.restore();
		state.cleanup();
	}
});

test('logout forwards its AbortSignal to the auth request', async () => {
	const state = harness();
	const controller = new AbortController();
	const signOutStarted = deferred<void>();
	const signOutResponse = deferred<{ ok: true; data: { ok: true } }>();
	current.signOutGate = signOutResponse.promise;
	current.signOutStarted = () => signOutStarted.resolve();
	try {
		const pending = state.client.signOutSocialAccount([], { signal: controller.signal });
		await signOutStarted.promise;
		const request = state.events.find((event) => event.type === 'sign-out');
		const signal = request?.init?.signal;
		assert.ok(signal);
		assert.notEqual(signal, controller.signal);
		controller.abort();
		assert.equal(signal.aborted, true);
		assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
	} finally {
		state.cleanup();
	}
});

test('storage account changes abort sign-out when no caller signal was provided', async () => {
	const state = harness();
	const browser = replaceStorageEventTarget();
	const storage = replaceLocalStorage({ manawg_account: 'account-a' });
	const signOutStarted = deferred<void>();
	const signOutResponse = deferred<{ ok: true; data: { ok: true } }>();
	current.signOutGate = signOutResponse.promise;
	current.signOutStarted = () => signOutStarted.resolve();
	try {
		const pending = state.client.signOutSocialAccount();
		await signOutStarted.promise;
		const signal = state.events.find((event) => event.type === 'sign-out')?.init?.signal;
		assert.ok(signal);

		storage.store.manawg_account = 'account-b';
		browser.target.dispatchEvent(new Event('storage'));
		assert.equal(signal.aborted, true);

		assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
		assert.deepEqual(storage.removed, []);
	} finally {
		storage.restore();
		browser.restore();
		state.cleanup();
	}
});

test('logout stops cache cleanup if the account changes while cache keys are pending', async () => {
	const state = harness();
	const storage = replaceLocalStorage({
		manawg_account: 'account-a',
		'manawg:draft:account-a': 'old',
	});
	const keysStarted = deferred<void>();
	const keys = deferred<string[]>();
	const deleted: string[] = [];
	const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			keys: () => {
				keysStarted.resolve();
				return keys.promise;
			},
			delete: async (key: string) => {
				deleted.push(key);
				return true;
			},
		},
	});
	try {
		const pending = state.client.signOutSocialAccount();
		await keysStarted.promise;
		storage.store.manawg_account = 'account-b';
		storage.store['manawg:draft:account-b'] = 'kept';
		keys.resolve(['manawg-app-account-B']);

		assert.deepEqual(await pending, { pushCleanup: 'none', cancelled: true });
		assert.deepEqual(deleted, []);
		assert.equal(storage.store.manawg_account, 'account-b');
		assert.equal(storage.store['manawg:draft:account-b'], 'kept');
		assert.equal(storage.removed.includes('manawg_account'), false);
	} finally {
		storage.restore();
		if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches);
		else Reflect.deleteProperty(globalThis, 'caches');
		state.cleanup();
	}
});
