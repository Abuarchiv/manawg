import assert from 'node:assert/strict';
import test from 'node:test';

const APP_ORIGIN = 'https://app.manawg.test';
const TARGET = `${APP_ORIGIN}/ausgaben?highlight=new#message-1`;

type Handler = (event: unknown) => void;
type WindowClient = {
	url: string;
	focus: () => unknown;
	navigate: (target: string) => unknown;
};

// The worker is a classic script that registers its listeners on the global `self` when loaded;
// loading it once against a recording `self` exposes the real notificationclick handler.
const handlers = new Map<string, Handler>();
const worker = globalThis as unknown as { self: unknown; clients: unknown };
worker.self = {
	location: { origin: APP_ORIGIN },
	addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
};
await import(new URL('../public/sw.js', import.meta.url).href);

async function clickNotification(url: string, windows: WindowClient[]) {
	const opened: string[] = [];
	worker.clients = {
		matchAll: async () => windows,
		openWindow: async (target: string) => {
			opened.push(target);
			return null;
		},
	};

	let completion: Promise<unknown> | undefined;
	handlers.get('notificationclick')?.({
		notification: { data: { url }, close() {} },
		waitUntil: (promise: Promise<unknown>) => {
			completion = promise;
		},
	});
	await completion;
	return opened;
}

test('navigates a same-path window to the notification query and fragment before focusing', async () => {
	const calls: unknown[] = [];
	const windowClient: WindowClient = {
		url: `${APP_ORIGIN}/ausgaben?highlight=old`,
		focus: async () => calls.push(['focus', windowClient.url]),
		navigate: async (target: string) => {
			calls.push(['navigate', target]);
			windowClient.url = target;
			return windowClient;
		},
	};

	const opened = await clickNotification('/ausgaben?highlight=new#message-1', [windowClient]);

	assert.deepEqual(calls, [
		['navigate', TARGET],
		['focus', TARGET],
	]);
	assert.deepEqual(opened, []);
});

test('focuses an exact full-URL match without navigating', async () => {
	const calls: unknown[] = [];
	const windowClient: WindowClient = {
		url: TARGET,
		focus: async () => calls.push('focus'),
		navigate: async () => calls.push('navigate'),
	};

	const opened = await clickNotification('/ausgaben?highlight=new#message-1', [windowClient]);

	assert.deepEqual(calls, ['focus']);
	assert.deepEqual(opened, []);
});

for (const result of ['null', 'reject']) {
	test(`opens the target when a matching tab ${result === 'null' ? 'closes' : 'cannot navigate'}`, async () => {
		const calls: unknown[] = [];
		const windowClient: WindowClient = {
			url: `${APP_ORIGIN}/ausgaben?highlight=old`,
			focus: async () => calls.push('focus'),
			navigate: async () => {
				calls.push('navigate');
				if (result === 'reject') throw new Error('window closed');
				return null;
			},
		};

		const opened = await clickNotification('/ausgaben?highlight=new#message-1', [windowClient]);

		assert.deepEqual(calls, ['navigate']);
		assert.deepEqual(opened, [TARGET]);
	});
}

test('does not navigate to a foreign target and opens the app root', async () => {
	const calls: unknown[] = [];
	const windowClient: WindowClient = {
		url: `${APP_ORIGIN}/ausgaben?highlight=old`,
		focus: async () => calls.push('focus'),
		navigate: async () => calls.push('navigate'),
	};

	const opened = await clickNotification(
		'https://foreign.example/ausgaben?highlight=new#message-1',
		[windowClient],
	);

	assert.deepEqual(calls, []);
	assert.deepEqual(opened, ['/']);
});

type Timer = { fn: () => void; ms: number };

// The worker reads fetch, caches and setTimeout from the global scope when an event fires, so a
// test swaps those globals around one navigation and restores them afterwards.
async function withNetwork(
	{
		fetch,
		cached,
	}: {
		fetch: (request: unknown, init: { signal: AbortSignal }) => Promise<unknown>;
		cached: Record<string, unknown>;
	},
	run: (timers: Timer[]) => Promise<void>,
) {
	const scope = globalThis as unknown as Record<string, unknown>;
	const names = ['fetch', 'caches', 'setTimeout', 'clearTimeout'];
	const original = names.map((name) => scope[name]);
	const timers: Timer[] = [];
	scope.fetch = fetch;
	scope.caches = {
		match: async (key: string | { url: string }) =>
			cached[typeof key === 'string' ? key : new URL(key.url).pathname],
		open: async () => ({ put: async () => undefined, addAll: async () => undefined }),
	};
	scope.setTimeout = (fn: () => void, ms: number) => timers.push({ fn, ms });
	scope.clearTimeout = () => undefined;
	try {
		await run(timers);
	} finally {
		names.forEach((name, index) => {
			scope[name] = original[index];
		});
	}
}

function navigateTo(pathname: string) {
	let response: Promise<unknown> | undefined;
	handlers.get('fetch')?.({
		request: {
			method: 'GET',
			mode: 'navigate',
			url: `${APP_ORIGIN}${pathname}`,
			headers: { get: () => 'text/html' },
		},
		respondWith: (promise: Promise<unknown>) => {
			response = promise;
		},
	});
	return response;
}

test('a navigation the network does not answer in time falls back to the offline page', async () => {
	await withNetwork(
		{
			fetch: (_request, { signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				}),
			cached: { '/offline': 'offline-page' },
		},
		async (timers) => {
			const pending = navigateTo('/wg/ABCD2345/ausgaben');
			assert.equal(timers.length, 1);
			assert.equal(timers[0]?.ms, 15000);
			timers[0]?.fn();

			assert.equal(await pending, 'offline-page');
		},
	);
});

test('a timely answer is served as is', async () => {
	const answer = { ok: true, clone: () => answer };
	await withNetwork({ fetch: async () => answer, cached: {} }, async () => {
		assert.equal(await navigateTo('/wg/ABCD2345/ausgaben'), answer);
	});
});

test('a response whose headers arrived is passed on without reading the body', async () => {
	const answer = {
		ok: true,
		type: 'basic',
		body: {},
		clone: () => {
			throw new Error('body must not be buffered');
		},
	};
	await withNetwork(
		{ fetch: async () => answer, cached: { '/offline': 'offline-page' } },
		async () => {
			assert.equal(await navigateTo('/wg/ABCD2345/ausgaben'), answer);
		},
	);
});
