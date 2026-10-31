import assert from 'node:assert/strict';
import test from 'node:test';

const APP_ORIGIN = 'https://app.manawg.test';
const TARGET = `${APP_ORIGIN}/expenses?highlight=new#message-1`;

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
		url: `${APP_ORIGIN}/expenses?highlight=old`,
		focus: async () => calls.push(['focus', windowClient.url]),
		navigate: async (target: string) => {
			calls.push(['navigate', target]);
			windowClient.url = target;
			return windowClient;
		},
	};

	const opened = await clickNotification('/expenses?highlight=new#message-1', [windowClient]);

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

	const opened = await clickNotification('/expenses?highlight=new#message-1', [windowClient]);

	assert.deepEqual(calls, ['focus']);
	assert.deepEqual(opened, []);
});

for (const result of ['null', 'reject']) {
	test(`opens the target when a matching tab ${result === 'null' ? 'closes' : 'cannot navigate'}`, async () => {
		const calls: unknown[] = [];
		const windowClient: WindowClient = {
			url: `${APP_ORIGIN}/expenses?highlight=old`,
			focus: async () => calls.push('focus'),
			navigate: async () => {
				calls.push('navigate');
				if (result === 'reject') throw new Error('window closed');
				return null;
			},
		};

		const opened = await clickNotification('/expenses?highlight=new#message-1', [windowClient]);

		assert.deepEqual(calls, ['navigate']);
		assert.deepEqual(opened, [TARGET]);
	});
}

test('does not navigate to a foreign target and opens the app root', async () => {
	const calls: unknown[] = [];
	const windowClient: WindowClient = {
		url: `${APP_ORIGIN}/expenses?highlight=old`,
		focus: async () => calls.push('focus'),
		navigate: async () => calls.push('navigate'),
	};

	const opened = await clickNotification(
		'https://foreign.example/expenses?highlight=new#message-1',
		[windowClient],
	);

	assert.deepEqual(calls, []);
	assert.deepEqual(opened, ['/']);
});

type Timer = { fn: () => void; ms: number };
type FetchInit = { signal: AbortSignal; cache?: string };

const urlOf = (key: string | { url: string }) =>
	new URL(typeof key === 'string' ? key : key.url, APP_ORIGIN).href;

// The worker reads fetch, caches and setTimeout from the global scope when an event fires, so a
// test swaps those globals around one navigation and restores them afterwards. `shell` backs the
// shell cache; addAll stores a placeholder per URL without going through fetch.
async function withNetwork(
	{
		fetch,
		cached,
		shell = new Map<string, Response>(),
	}: {
		fetch: (request: unknown, init: FetchInit) => Promise<unknown>;
		cached: Record<string, unknown>;
		shell?: Map<string, Response>;
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
		open: async () => ({
			put: async (key: string | { url: string }, response: Response) => {
				shell.set(urlOf(key), response);
			},
			addAll: async (urls: string[]) => {
				for (const url of urls) shell.set(urlOf(url), new Response('chunk'));
			},
			match: async (key: string | { url: string }) => shell.get(urlOf(key)),
			keys: async () => [...shell.keys()].map((url) => ({ url })),
			delete: async (key: string | { url: string }) => shell.delete(urlOf(key)),
		}),
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

function navigateTo(pathname: string, background: Promise<unknown>[] = []) {
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
		waitUntil: (promise: Promise<unknown>) => {
			background.push(promise);
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
			const pending = navigateTo('/wg/ABCD2345/expenses');
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
		assert.equal(await navigateTo('/wg/ABCD2345/expenses'), answer);
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
			assert.equal(await navigateTo('/wg/ABCD2345/expenses'), answer);
		},
	);
});

const OFFLINE = `${APP_ORIGIN}/offline`;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toUTCString();
const offlinePage = (chunks: string[], dateHeader: string) =>
	new Response(chunks.map((chunk) => `<script src="/_next/static/${chunk}"></script>`).join(''), {
		headers: { date: dateHeader },
	});

// A cached shell holding an old offline page, its chunks and an icon that no deploy replaces.
function cachedShell(ageHours: number) {
	return new Map<string, Response>([
		[OFFLINE, offlinePage(['chunks/old.js', 'chunks/shared.js'], hoursAgo(ageHours))],
		[`${APP_ORIGIN}/_next/static/chunks/old.js`, new Response('old')],
		[`${APP_ORIGIN}/_next/static/chunks/shared.js`, new Response('shared')],
		[`${APP_ORIGIN}/icon-192.png`, new Response('icon')],
	]);
}

async function browse(shell: Map<string, Response>, refresh: () => Promise<unknown>) {
	const answer = { ok: true, clone: () => answer };
	const fetches: Array<[unknown, unknown]> = [];
	await withNetwork(
		{
			fetch: async (request, init) => {
				fetches.push([request, init]);
				return request === '/offline' ? refresh() : answer;
			},
			cached: {},
			shell,
		},
		async () => {
			const background: Promise<unknown>[] = [];
			assert.equal(await navigateTo('/wg/ABCD2345/expenses', background), answer);
			await Promise.all(background);
		},
	);
	return fetches.filter(([request]) => request === '/offline');
}

test('a stale offline page is revalidated after a navigation and its unused chunks are pruned', async () => {
	const shell = cachedShell(7);
	const refreshes = await browse(shell, async () =>
		offlinePage(['chunks/new.js', 'chunks/shared.js'], hoursAgo(0)),
	);

	assert.deepEqual(refreshes, [['/offline', { cache: 'reload' }]]);
	assert.match((await shell.get(OFFLINE)?.text()) ?? '', /chunks\/new\.js/);
	assert.deepEqual(
		[...shell.keys()].sort(),
		[
			OFFLINE,
			`${APP_ORIGIN}/_next/static/chunks/new.js`,
			`${APP_ORIGIN}/_next/static/chunks/shared.js`,
			`${APP_ORIGIN}/icon-192.png`,
		].sort(),
	);
});

test('a fresh offline page is left alone', async () => {
	const shell = cachedShell(1);
	const refreshes = await browse(shell, async () => {
		throw new Error('must not be fetched');
	});

	assert.deepEqual(refreshes, []);
	assert.equal(shell.has(`${APP_ORIGIN}/_next/static/chunks/old.js`), true);
});

for (const failure of ['rejects', 'answers with an error']) {
	test(`a revalidation that ${failure} keeps the old offline page and its chunks`, async () => {
		const shell = cachedShell(7);
		const before = [...shell.keys()];
		const refreshes = await browse(shell, async () => {
			if (failure === 'rejects') throw new Error('offline');
			return Object.assign(offlinePage(['chunks/new.js'], hoursAgo(0)), { ok: false });
		});

		assert.equal(refreshes.length, 1);
		assert.deepEqual([...shell.keys()], before);
		assert.match((await shell.get(OFFLINE)?.text()) ?? '', /chunks\/old\.js/);
	});
}
