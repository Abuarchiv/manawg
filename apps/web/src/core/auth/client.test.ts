import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Logout runs against the real push-subscribe module; only the API client, the Supabase
// browser client and the browser globals are stand-ins.

type LogoutEvent =
	| { type: 'local-unsubscribe' }
	| { type: 'sign-out' }
	| {
			type: 'server-unsubscribe';
			url: string;
			init: { method?: string; body?: string; memberId?: string };
	  };

const ENDPOINT = 'https://push.example.test/browser-endpoint';

const state = {
	events: [] as LogoutEvent[],
	serverAvailable: true,
	unsubscribeResult: true,
	subscriptionActive: true,
};

mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: async (url: string, init: { method?: string; body?: string; memberId?: string }) => {
			state.events.push({ type: 'server-unsubscribe', url, init });
			return state.serverAvailable
				? { ok: true, data: { ok: true } }
				: { ok: false, status: 503, error: 'server_error' };
		},
	},
});
mock.module('@supabase/ssr', {
	namedExports: {
		createBrowserClient: () => ({
			auth: {
				signOut: async () => {
					state.events.push({ type: 'sign-out' });
					return { error: null };
				},
			},
		}),
	},
});
mock.module('./supabase-env', {
	namedExports: {
		getSupabaseEnv: () => ({ url: 'https://auth.example.test', publishableKey: 'test' }),
	},
});

const { signOutSocialAccount } = await import('./client');

function defineGlobal(name: string, value: unknown): () => void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, { configurable: true, value });
	return () => {
		if (previous) Object.defineProperty(globalThis, name, previous);
		else Reflect.deleteProperty(globalThis, name);
	};
}

function harness({ serverAvailable = true, unsubscribeResult = true } = {}) {
	state.events = [];
	state.serverAvailable = serverAvailable;
	state.unsubscribeResult = unsubscribeResult;
	state.subscriptionActive = true;
	const subscription = {
		endpoint: ENDPOINT,
		unsubscribe: async () => {
			state.events.push({ type: 'local-unsubscribe' });
			if (state.unsubscribeResult) state.subscriptionActive = false;
			return state.unsubscribeResult;
		},
	};
	return defineGlobal('navigator', {
		serviceWorker: {
			getRegistration: async () => ({
				pushManager: { getSubscription: async () => subscription },
			}),
		},
	});
}

function serverCleanups() {
	return state.events.flatMap((event) => (event.type === 'server-unsubscribe' ? [event] : []));
}

test('shared logout retires this browser endpoint before clearing its local subscription and auth', async () => {
	const cleanup = harness();
	try {
		const result = await signOutSocialAccount([
			{ code: 'ABCD2345', memberId: 'member-a' },
			{ code: 'BCDE2345', memberId: 'member-b' },
		]);
		const [first, second] = serverCleanups();
		assert.equal(serverCleanups().length, 2);
		assert.ok(first && second);
		assert.equal(first.url, '/api/wg/ABCD2345/notifications');
		assert.equal(first.init.method, 'POST');
		assert.deepEqual(JSON.parse(String(first.init.body)), {
			action: 'push_unsubscribe',
			endpoint: ENDPOINT,
		});
		assert.equal(first.init.memberId, 'member-a');
		assert.equal(Object.hasOwn(first.init, 'memberToken'), false);
		assert.equal(second.url, '/api/wg/BCDE2345/notifications');
		assert.equal(JSON.parse(String(second.init.body)).endpoint, ENDPOINT);
		assert.equal(second.init.memberId, 'member-b');
		assert.equal(state.subscriptionActive, false);
		assert.deepEqual(result, { pushCleanup: 'unsubscribed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		cleanup();
	}
});

test('logout still unsubscribes locally and signs out when the server is offline', async () => {
	const cleanup = harness({ serverAvailable: false });
	try {
		const result = await signOutSocialAccount([{ code: 'ABCD2345', memberId: 'member-a' }]);
		assert.equal(state.subscriptionActive, false);
		assert.deepEqual(result, { pushCleanup: 'unsubscribed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
	} finally {
		cleanup();
	}
});

test('logout reports when browser unsubscribe failed but still clears the auth session', async () => {
	const cleanup = harness({ unsubscribeResult: false });
	try {
		const result = await signOutSocialAccount([{ code: 'ABCD2345', memberId: 'member-a' }]);
		assert.deepEqual(result, { pushCleanup: 'failed' });
		assert.equal(state.events.at(-1)?.type, 'sign-out');
		assert.equal(state.subscriptionActive, true);
	} finally {
		cleanup();
	}
});

test('logout wipes account-bound browser data but keeps the theme', async () => {
	const store = new Map([
		['manawg:offline-actions', '[]'],
		['manawg:draft:ABCD2345:m:expense', '{}'],
		['manawg_identity:wg', '{}'],
		['manawg-theme', 'dark'],
	]);
	const deleted: string[] = [];
	const storage = new Proxy(
		{ removeItem: (key: string) => store.delete(key) },
		{
			ownKeys: () => [...store.keys()],
			getOwnPropertyDescriptor: (_, key) =>
				typeof key === 'string' && store.has(key)
					? { enumerable: true, configurable: true, value: 1 }
					: undefined,
		},
	);
	const restores = [
		defineGlobal('localStorage', storage),
		defineGlobal('indexedDB', {
			deleteDatabase: (name: string) => {
				deleted.push(`idb:${name}`);
				const request: { onsuccess?: () => void } = {};
				queueMicrotask(() => request.onsuccess?.());
				return request;
			},
		}),
		defineGlobal('caches', {
			keys: async () => ['manawg-app-v4-shell', 'other'],
			delete: async (key: string) => deleted.push(`cache:${key}`),
		}),
		harness(),
	];
	try {
		await signOutSocialAccount();
		assert.deepEqual([...store.keys()], ['manawg-theme']);
		assert.deepEqual(deleted.sort(), ['cache:manawg-app-v4-shell', 'idb:manawg-offline-images']);
	} finally {
		for (const restore of restores) restore();
	}
});
