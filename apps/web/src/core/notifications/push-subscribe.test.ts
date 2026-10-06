import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };

const api = { response: { ok: true, data: { ok: true } } as ApiResult };

mock.module('@/core/infra/api-client', {
	namedExports: { apiFetch: async () => api.response },
});

const { unsubscribeWebPush } = await import('./push-subscribe');

async function disablePushInOneWg(
	endpointInUse: boolean,
	response: ApiResult = { ok: true, data: { ok: true, endpointInUse } },
): Promise<boolean> {
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
				ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
			},
		},
	});
	try {
		api.response = response;
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
