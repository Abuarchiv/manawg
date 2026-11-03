import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

const { apiFetch, SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT } = await import(
	'../src/core/infra/api-client.ts'
);

function setup(
	t: TestContext,
	responses: Array<() => Promise<Response> | Response>,
	signedIn = { account: 'account-1' },
) {
	const originalFetch = globalThis.fetch;
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const events: string[] = [];
	const fakeWindow = Object.assign(new EventTarget(), {
		localStorage: { getItem: () => signedIn.account },
	});
	for (const name of [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]) {
		fakeWindow.addEventListener(name, () => events.push(name));
	}
	Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
	let call = 0;
	globalThis.fetch = (async () => responses[call++]?.()) as typeof fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
		else Reflect.deleteProperty(globalThis, 'window');
	});
	return events;
}

const expired = () =>
	new Response(JSON.stringify({ error: 'auth_required' }), {
		status: 401,
		headers: { 'content-type': 'application/json' },
	});
const okJson = () =>
	new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
const noContent = () => new Response(null, { status: 204 });

test('a WG request that succeeds after a session expiry announces the restored session once', async (t) => {
	const events = setup(t, [expired, okJson, okJson]);
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/wg/abc/shopping');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]);
});

test('an empty 204 answer after a session expiry also announces the restored session', async (t) => {
	const events = setup(t, [expired, noContent]);
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/wg/abc/shopping/1', { method: 'DELETE' });
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]);
});

test('a successful public request does not announce a restored session', async (t) => {
	const events = setup(t, [expired, okJson, okJson]);
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/public/status');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
	await apiFetch('/api/wg/abc/shopping');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]);
});

test('a request that started before the expiry does not announce a restored session', async (t) => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const events = setup(t, [
		async () => {
			await gate;
			return okJson();
		},
		expired,
		okJson,
	]);
	const stale = apiFetch('/api/wg/abc/members');
	await apiFetch('/api/wg/abc/shopping');
	release();
	await stale;
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
	await apiFetch('/api/wg/abc/shopping');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]);
});

test('a successful request without a prior expiry announces nothing', async (t) => {
	const events = setup(t, [okJson, noContent]);
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/wg/abc/shopping/1', { method: 'DELETE' });
	assert.deepEqual(events, []);
});

test('a WG answer that arrives after an account switch does not announce a restored session', async (t) => {
	const signedIn = { account: 'account-1' };
	const events = setup(
		t,
		[
			expired,
			() => {
				signedIn.account = 'account-2';
				return okJson();
			},
			okJson,
		],
		signedIn,
	);
	await apiFetch('/api/wg/abc/shopping');
	await apiFetch('/api/wg/abc/shopping');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
	await apiFetch('/api/wg/abc/shopping');
	assert.deepEqual(events, [SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT]);
});
