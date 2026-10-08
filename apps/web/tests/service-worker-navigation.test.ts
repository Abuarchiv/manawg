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
await import('../public/sw.js');

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
