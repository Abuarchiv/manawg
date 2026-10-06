import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type FetchResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };

const transport = {
	apiFetch: (_url: string): Promise<FetchResult> => Promise.resolve({ ok: true, data: [] }),
	generation: 0,
};

mock.module('@/core/infra/api-client', {
	namedExports: {
		apiFetch: (url: string) => transport.apiFetch(url),
		mutationGeneration: () => transport.generation,
	},
});

const {
	cacheKey,
	fetchAndCache,
	prefetchCachedFetch,
	readCachedSnapshot,
	refreshCacheEntry,
	updateCache,
} = await import('../src/core/hooks/cached-fetch-store.ts');

let keyCounter = 0;
/** Every test works on its own cache entry; the store is module state shared by the file. */
function freshKey(): string {
	keyCounter += 1;
	return `key-${keyCounter}`;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function nth<T>(items: readonly T[], index: number): T {
	const item = items[index];
	if (item === undefined) throw new Error(`no item ${index}`);
	return item;
}

const settle = () => new Promise((done) => setImmediate(done));

test('a refresh during a running GET fetches again instead of joining the stale GET', async () => {
	const responses = [deferred<FetchResult>(), deferred<FetchResult>()];
	let calls = 0;
	transport.apiFetch = () => nth(responses, calls++).promise;
	const key = freshKey();

	const initial = fetchAndCache(key, '/api/items', {});
	// e.g. a mutation finished here and the page asks for fresh data
	const afterMutation = fetchAndCache(key, '/api/items', {}, true);
	const concurrent = fetchAndCache(key, '/api/items', {}, true);
	assert.equal(calls, 1);
	assert.equal(concurrent, afterMutation);

	nth(responses, 0).resolve({ ok: true, data: ['before'] });
	await initial;
	await settle();
	assert.equal(calls, 2);
	nth(responses, 1).resolve({ ok: true, data: ['after'] });
	await afterMutation;
	assert.equal(calls, 2);
});

test('sequential refreshes start one GET each', async () => {
	let calls = 0;
	transport.apiFetch = async () => {
		calls += 1;
		return { ok: true, data: [] };
	};
	const key = freshKey();
	await fetchAndCache(key, '/api/items', {});
	await fetchAndCache(key, '/api/items', {});
	assert.equal(calls, 2);
});

test('overlapping plain refreshes (focus, polling) share the running GET', async () => {
	const response = deferred<FetchResult>();
	let calls = 0;
	transport.apiFetch = () => {
		calls += 1;
		return response.promise;
	};
	const key = freshKey();
	const first = fetchAndCache(key, '/api/items', {});
	const second = fetchAndCache(key, '/api/items', {});
	assert.equal(second, first);
	response.resolve({ ok: true, data: [] });
	await first;
	await settle();
	assert.equal(calls, 1);
});

test('a plain refresh after any mutation settled does not join the older GET', async () => {
	const responses = [deferred<FetchResult>(), deferred<FetchResult>()];
	let calls = 0;
	transport.apiFetch = () => nth(responses, calls++).promise;
	const key = freshKey();
	const running = fetchAndCache(key, '/api/items', {});
	transport.generation += 1; // e.g. a POST on the Pinnwand finished meanwhile
	const followUp = fetchAndCache(key, '/api/items', {});
	assert.notEqual(followUp, running);
	nth(responses, 0).resolve({ ok: true, data: ['before'] });
	await running;
	await settle();
	assert.equal(calls, 2);
	nth(responses, 1).resolve({ ok: true, data: ['after'] });
	await followUp;
});

test('refresh errors survive a concurrent local cache update without replacing it', async () => {
	for (const failure of ['http', 'network']) {
		const response = deferred<FetchResult>();
		let initial = true;
		transport.apiFetch = () => {
			if (!initial) return response.promise;
			initial = false;
			return Promise.resolve({ ok: true, data: ['initial'] });
		};
		const key = freshKey();
		await refreshCacheEntry(key, '/api/items', {});
		const pending = refreshCacheEntry(key, '/api/items', {});
		updateCache(key, ['newer local data']);
		if (failure === 'http') {
			response.resolve({ ok: false, status: 503, error: 'service_unavailable' });
		} else {
			response.reject(new Error('offline'));
		}
		assert.equal((await pending).ok, false, failure);
		const current = readCachedSnapshot<string[]>(key);
		assert.deepEqual(current.data, ['newer local data']);
		assert.equal(current.error?.status, failure === 'http' ? 503 : 0);
		assert.equal(current.isFetching, false);
	}
});

test('a successful stale refresh preserves newer local data', async () => {
	const response = deferred<FetchResult>();
	let initial = true;
	transport.apiFetch = () => {
		if (!initial) return response.promise;
		initial = false;
		return Promise.resolve({ ok: true, data: ['initial'] });
	};
	const key = freshKey();
	await refreshCacheEntry(key, '/api/items', {});
	const pending = refreshCacheEntry(key, '/api/items', {});
	updateCache(key, ['newer local data']);
	response.resolve({ ok: true, data: ['stale server data'] });
	await pending;
	const current = readCachedSnapshot<string[]>(key);
	assert.deepEqual(current.data, ['newer local data']);
	assert.equal(current.error, undefined);
	assert.equal(current.isFetching, false);
});

test('local updates made before the first response are replayed on top of it', async () => {
	const response = deferred<FetchResult>();
	transport.apiFetch = () => response.promise;
	const key = freshKey();
	const pending = refreshCacheEntry<string[]>(key, '/api/items', {});
	updateCache<string[]>(key, (current) => [...(current ?? []), 'optimistic']);
	response.resolve({ ok: true, data: ['server'] });
	const result = await pending;
	assert.deepEqual(result.ok && result.data, ['server', 'optimistic']);
	assert.deepEqual(readCachedSnapshot<string[]>(key).serverData, ['server']);
});

test('the idle warm-up skips an entry that already holds data and fills an empty one', async () => {
	let calls = 0;
	transport.apiFetch = () => {
		calls += 1;
		return Promise.resolve({ ok: true, data: ['server'] });
	};
	const url = `/api/warm-${freshKey()}`;
	await fetchAndCache(cacheKey(url, 'member'), url, { memberId: 'member' });
	assert.equal(calls, 1);
	await prefetchCachedFetch(url, { memberId: 'member' });
	assert.equal(calls, 1);

	const emptyUrl = `/api/warm-${freshKey()}`;
	await prefetchCachedFetch(emptyUrl, { memberId: 'member' });
	assert.equal(calls, 2);
	assert.deepEqual(readCachedSnapshot<string[]>(cacheKey(emptyUrl, 'member')).data, ['server']);
});
