import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Real client.ts and push-subscribe.ts run against a recording fake of the network
// and the browser's push subscription; the events array keeps their order.

type Event = {
	type: string;
	url?: string;
	init?: { method?: string; body?: string; memberId?: string } | undefined;
};

const current = {
	events: [] as Event[],
	serverAvailable: true,
};

mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async (url: string, init?: Event['init']) => {
			if (url === '/api/auth/sign-out') {
				current.events.push({ type: 'sign-out' });
				return { ok: true, data: { ok: true } };
			}
			current.events.push({ type: 'server-unsubscribe', url, init });
			return current.serverAvailable
				? { ok: true, data: { ok: true } }
				: { ok: false, status: 503, error: 'server_error' };
		},
	},
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
	const names = ['localStorage', 'indexedDB', 'caches'];
	const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
	const storage = new Proxy(
		{ removeItem: (key: string) => store.delete(key) },
		{
			ownKeys: () => [...store.keys()],
			getOwnPropertyDescriptor: (_, key) =>
				store.has(key as string) ? { enumerable: true, configurable: true, value: 1 } : undefined,
		},
	);
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
	Object.defineProperty(globalThis, 'indexedDB', {
		configurable: true,
		value: {
			deleteDatabase: (name: string) => {
				deleted.push(`idb:${name}`);
				const request: { onsuccess?: () => void } = {};
				queueMicrotask(() => request.onsuccess?.());
				return request;
			},
		},
	});
	Object.defineProperty(globalThis, 'caches', {
		configurable: true,
		value: {
			keys: async () => ['manawg-app-v4-shell', 'other'],
			delete: async (key: string) => deleted.push(`cache:${key}`),
		},
	});
	const state = harness();
	try {
		await state.client.signOutSocialAccount();
		assert.deepEqual([...store.keys()], ['manawg-theme']);
		assert.deepEqual(deleted.sort(), ['cache:manawg-app-v4-shell', 'idb:manawg-offline-images']);
	} finally {
		state.cleanup();
		names.forEach((name, i) => {
			if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
});
