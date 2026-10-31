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

const ok = { ok: true, status: 200, data: {} };

test('sync replays only the actions of the syncing member', async () => {
	let requests = 0;
	const { module, storage } = await makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return ok;
		},
	});
	await setQueue(module, [createAction(), createAction({ id: 'other', memberId: 'member-b' })]);

	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		1,
	);
	assert.equal(requests, 1);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['other'],
	);
});

test('sync replays only the actions of the WG being synced', async () => {
	let requests = 0;
	const { module, storage } = await makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return ok;
		},
	});
	await setQueue(module, [createAction(), createAction({ id: 'other', shareCode: 'OTHER123' })]);

	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		1,
	);
	assert.equal(requests, 1);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['other'],
	);
});

test('a member_context_changed answer asks for a new login instead of a server review', async () => {
	const { module } = await makeQueueModule({
		apiFetch: async () => ({ ok: false, status: 409, error: 'member_context_changed' }),
	});
	await setQueue(module, [createAction()]);

	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });

	const [entry] = module.readOfflineQueue();
	assert.equal(entry.needsReview, undefined);
	assert.equal(entry.lastError, 'reauth');
});

test('the first login on a device keeps the queued actions', async () => {
	const { module, storage } = await makeQueueModule();
	assert.equal(storage.getItem('manawg_account'), null);
	await setQueue(module, [createAction()]);

	await module.adoptLocalAccount('user-1');

	assert.equal(storage.getItem('manawg_account'), 'user-1');
	assert.deepEqual(
		module.readOfflineQueue().map((action) => action.id),
		['action-1'],
	);
});
