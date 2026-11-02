import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	createAction,
	makeQueueModule,
	readStoredQueue,
	restoreGlobals,
	setQueue,
} from './support/offline-harness.ts';

afterEach(restoreGlobals);

const sync = (module: Awaited<ReturnType<typeof makeQueueModule>>['module'], force = false) =>
	module.syncOfflineActions('TEST1234', { force, memberId: 'member-a' });

test('an automatic sync leaves an action alone while its retry delay runs, a manual one sends it', async () => {
	let requests = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return { ok: true, status: 200, data: {} };
		},
		queue: { shouldRetryOfflineAction: () => false },
	});
	await setQueue(module, [createAction()]);

	assert.equal(await sync(module), 0);
	assert.equal(requests, 0);
	assert.equal(await sync(module, true), 1);
	assert.equal(requests, 1);
});

test('a rate-limit answer stops the sync so the other actions are not sent into the same limit', async () => {
	const sent: string[] = [];
	const { module, storage } = await makeQueueModule({
		apiFetch: async (path) => {
			sent.push(path);
			return { ok: false, status: 429, error: 'too_many_requests' };
		},
	});
	await setQueue(module, [createAction({ id: 'first' }), createAction({ id: 'second' })]);

	await sync(module, true);

	assert.equal(sent.length, 1);
	const [first, second] = readStoredQueue(storage);
	assert.equal(first?.attempts, 1);
	assert.equal(second?.attempts, undefined);
});

test('a network error that throws counts an attempt, so the retry delay grows', async () => {
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			throw new Error('network');
		},
	});
	await setQueue(module, [createAction({ attempts: 2 })]);

	await sync(module, true);

	assert.equal(module.readOfflineQueue()[0].attempts, 3);
});

test('an answer the server will repeat holds the action for review instead of resending it', async () => {
	let requests = 0;
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return { ok: false, status: 422, error: 'invalid_body' };
		},
	});
	await setQueue(module, [createAction()]);

	await sync(module, true);
	assert.equal(module.needsManualOfflineResolution(module.readOfflineQueue()[0]), true);
	await sync(module, true);
	assert.equal(requests, 1);
});

test('a server error is retried: counted, not held', async () => {
	const { module } = await makeQueueModule({
		apiFetch: async () => ({ ok: false, status: 503, error: 'unavailable' }),
	});
	await setQueue(module, [createAction()]);

	await sync(module, true);

	const [entry] = module.readOfflineQueue();
	assert.equal(entry.attempts, 1);
	assert.equal(module.needsManualOfflineResolution(entry), false);
});

test('an action without a usable key counts an attempt and is never sent', async () => {
	let requests = 0;
	const { module } = await makeQueueModule({
		createKey: () => null,
		apiFetch: async () => {
			requests += 1;
			return { ok: true, status: 200, data: {} };
		},
	});
	await setQueue(module, [createAction({ idempotencyKey: undefined, attempts: 1 })]);

	await sync(module, true);

	assert.equal(requests, 0);
	assert.equal(module.readOfflineQueue()[0].attempts, 2);
});
