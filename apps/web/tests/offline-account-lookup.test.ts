import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const { getAccountMemberships } = await import('../src/app/offline/offline-page-helpers.ts');

const realFetch = globalThis.fetch;
const realTimeout = AbortSignal.timeout;
afterEach(() => {
	globalThis.fetch = realFetch;
	AbortSignal.timeout = realTimeout;
});

function hangingFetch(): typeof fetch {
	return ((_url: unknown, init?: RequestInit) =>
		new Promise((_resolve, reject) => {
			init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
		})) as typeof fetch;
}

test('a lookup that never answers rejects after the request timeout', async () => {
	const fired = new AbortController();
	const delays: number[] = [];
	AbortSignal.timeout = (ms) => {
		delays.push(ms);
		return fired.signal;
	};
	globalThis.fetch = hangingFetch();
	const settled = assert.rejects(getAccountMemberships());
	fired.abort(new DOMException('timed out', 'TimeoutError'));
	await Promise.race([
		settled,
		new Promise((_, fail) => setTimeout(() => fail(new Error('lookup still pending')), 200)),
	]);
	assert.deepEqual(delays, [15_000]);
});

test('an aborted caller signal ends the lookup before the timeout', async () => {
	globalThis.fetch = hangingFetch();
	const controller = new AbortController();
	const settled = assert.rejects(getAccountMemberships(controller.signal));
	controller.abort();
	await settled;
});
