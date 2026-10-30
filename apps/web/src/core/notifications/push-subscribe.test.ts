import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const state = { response: undefined as unknown };

mock.module('@/core/infra/api-client', { namedExports: { apiFetch: async () => state.response } });

const { subscribeWebPush, unsubscribeWebPush } = await import('./push-subscribe');

async function disablePushInOneWg(
	endpointInUse: boolean,
	response: unknown = { ok: true, data: { ok: true, endpointInUse } },
) {
	state.response = response;
	let browserUnsubscribed = false;
	const subscription = {
		endpoint: 'https://push.example.test/device',
		unsubscribe: async () => {
			browserUnsubscribed = true;
			return true;
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
	try {
		await unsubscribeWebPush('MTE8PZAT', 'member-a').catch(() => undefined);
	} finally {
		if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
	return browserUnsubscribed;
}

test('turning push off in one WG keeps the browser subscription another WG still uses', async () => {
	assert.equal(await disablePushInOneWg(true), false);
});

test('turning push off in the last WG that uses it unsubscribes the browser', async () => {
	assert.equal(await disablePushInOneWg(false), true);
});

test('a failed server opt-out keeps the browser subscription other WGs may share', async () => {
	assert.equal(
		await disablePushInOneWg(false, { ok: false, status: 0, error: 'Netzwerkfehler' }),
		false,
	);
});

function withGlobals<T>(values: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
	const previous = Object.keys(values).map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
	);
	for (const [key, value] of Object.entries(values)) {
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	return run().finally(() => {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	});
}

const pushWindow = { Notification: {}, PushManager: {} };

test('turning push on gives up when no service worker ever becomes active', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'AAAA';
	const outcome = withGlobals(
		{
			navigator: { serviceWorker: { ready: new Promise(() => undefined) } },
			window: pushWindow,
			Notification: { requestPermission: async () => 'granted' },
		},
		() =>
			subscribeWebPush('MTE8PZAT', 'member-a').then(
				() => null,
				(error: { copy: { key: string } }) => error,
			),
	);
	await new Promise((resolve) => setImmediate(resolve));
	t.mock.timers.tick(8000);
	assert.equal((await outcome)?.copy.key, 'settings.notifications.errors.pushServiceWorker');
});

test('turning push off does not wait for a service worker that is not active', async () => {
	state.response = { ok: true, data: { ok: true } };
	const navigator = {
		serviceWorker: { ready: new Promise(() => undefined), getRegistration: async () => undefined },
	};
	await withGlobals({ navigator, window: pushWindow }, () =>
		unsubscribeWebPush('MTE8PZAT', 'member-a'),
	);
});
