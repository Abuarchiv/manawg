import assert from 'node:assert/strict';
import test from 'node:test';

// The service worker is a classic script served from public/. It is loaded once against
// stand-ins for its worker globals; `clients` is read when a notification is clicked, so each
// test swaps the open windows behind it.

type WindowClient = {
	url: string;
	focus?: () => Promise<unknown>;
	navigate?: (target: string) => Promise<unknown>;
};
type NotificationClickEvent = {
	notification: { data: { url: string }; close(): void };
	waitUntil(promise: Promise<unknown>): void;
};

const APP_ORIGIN = 'https://app.manawg.test';
const TARGET = `${APP_ORIGIN}/ausgaben?highlight=new#message-1`;

const handlers = new Map<string, (event: NotificationClickEvent) => void>();
const worker = { windows: [] as WindowClient[], opened: [] as string[] };

Object.assign(globalThis, {
	self: {
		location: { origin: APP_ORIGIN },
		addEventListener: (type: string, handler: (event: NotificationClickEvent) => void) =>
			handlers.set(type, handler),
	},
	clients: {
		matchAll: async () => worker.windows,
		openWindow: async (target: string) => {
			worker.opened.push(target);
			return null;
		},
	},
});
await import(new URL('../public/sw.js', import.meta.url).href);

async function clickNotification(url: string, windows: WindowClient[]): Promise<string[]> {
	worker.windows = windows;
	worker.opened = [];
	const onClick = handlers.get('notificationclick');
	assert.ok(onClick, 'the service worker handles notification clicks');
	let completion: Promise<unknown> | undefined;
	onClick({
		notification: { data: { url }, close() {} },
		waitUntil: (promise) => {
			completion = promise;
		},
	});
	await completion;
	return worker.opened;
}

test('navigates a same-path window to the notification query and fragment before focusing', async () => {
	const calls: string[][] = [];
	const windowClient: WindowClient = {
		url: `${APP_ORIGIN}/ausgaben?highlight=old`,
		focus: async () => calls.push(['focus', windowClient.url]),
		navigate: async (target) => {
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
	const calls: string[] = [];
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
		const calls: string[] = [];
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
	const calls: string[] = [];
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
