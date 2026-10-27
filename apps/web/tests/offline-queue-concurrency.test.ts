import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	createAction,
	deferred,
	makeLockManager,
	makeQueueModule,
	makeStorage,
	readStoredQueue,
	restoreGlobals,
	setQueue,
} from './support/offline-harness.ts';

afterEach(restoreGlobals);

test('two tabs preserve both enqueues when the second reads during the first mutation', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = (await makeQueueModule({ storage, locks })).module;
	const second = (await makeQueueModule({ storage, locks })).module;
	const getItem = storage.getItem.bind(storage);
	let secondEnqueue: Promise<number> | undefined;
	storage.getItem = (key) => {
		const value = getItem(key);
		if (key === 'manawg:offline-actions' && !secondEnqueue) {
			secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
		}
		return value;
	};

	const firstCount = await first.enqueueOfflineAction(createAction());
	const secondCount = await secondEnqueue;
	assert.equal(firstCount, 1);
	assert.equal(secondCount, 2);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['action-1', 'action-2'],
	);
});

test('same-tab concurrent enqueues keep every action', async () => {
	const { module, storage } = await makeQueueModule();
	await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			module.enqueueOfflineAction(createAction({ id: `action-${index}` })),
		),
	);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		Array.from({ length: 8 }, (_, index) => `action-${index}`),
	);
});

test('queue writes and sync fail closed when Web Locks are unavailable', async () => {
	const storage = makeStorage();
	storage.setItem('manawg:offline-actions', JSON.stringify([createAction()]));
	let requests = 0;
	const { module } = await makeQueueModule({
		storage,
		locks: null,
		apiFetch: async () => {
			requests += 1;
			return { ok: true, data: {} };
		},
	});
	assert.equal(await module.enqueueOfflineAction(createAction({ id: 'action-2' })), 0);
	assert.equal(await module.discardQueuedEntry('TEST1234', 'action-1'), 'storage_blocked');
	assert.equal(
		await module.discardQueuedEntry('TEST1234', '11111111-1111-4111-8111-111111111111'),
		'not_queued',
	);
	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		0,
	);
	assert.equal(requests, 0);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['action-1'],
	);
});

test('discarding a queued update for a server item still fails closed without Web Locks', async () => {
	const serverItemId = '11111111-1111-4111-8111-111111111111';
	const storage = makeStorage();
	storage.setItem(
		'manawg:offline-actions',
		JSON.stringify([
			createAction({
				id: 'shopping-update',
				type: 'shopping.update',
				payload: { itemId: serverItemId, name: 'Milch', bought: true },
			}),
		]),
	);
	const { module } = await makeQueueModule({ storage, locks: null });
	assert.equal(await module.discardQueuedEntry('TEST1234', serverItemId), 'storage_blocked');
	assert.equal(readStoredQueue(storage).length, 1);
});

test('discard during a second-tab enqueue preserves the new action', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = (await makeQueueModule({ storage, locks })).module;
	const second = (await makeQueueModule({ storage, locks })).module;
	await setQueue(first, [createAction()]);
	const getItem = storage.getItem.bind(storage);
	let queueReads = 0;
	let secondEnqueue: Promise<number> | undefined;
	storage.getItem = (key) => {
		const value = getItem(key);
		if (key === 'manawg:offline-actions' && ++queueReads === 2) {
			secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
		}
		return value;
	};
	assert.equal(await first.discardQueuedEntry('TEST1234', 'action-1'), 'removed');
	assert.equal(await secondEnqueue, 1);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['action-2'],
	);
});

test('edit during a second-tab enqueue preserves both the edit and new action', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = (await makeQueueModule({ storage, locks })).module;
	const second = (await makeQueueModule({ storage, locks })).module;
	await setQueue(first, [createAction()]);
	const getItem = storage.getItem.bind(storage);
	let secondEnqueue: Promise<number> | undefined;
	storage.getItem = (key) => {
		const value = getItem(key);
		if (key === 'manawg:offline-actions' && !secondEnqueue) {
			secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
		}
		return value;
	};
	assert.equal(
		await first.updateOfflineQueue((actions) =>
			actions.map((action) =>
				action.id === 'action-1'
					? { ...action, payload: { ...action.payload, content: 'edited' } }
					: action,
			),
		),
		true,
	);
	assert.equal(await secondEnqueue, 2);
	const queue = readStoredQueue(storage);
	assert.equal(queue.find((action) => action.id === 'action-1')?.payload.content, 'edited');
	assert.deepEqual(
		queue.map((action) => action.id),
		['action-1', 'action-2'],
	);
});

test('sync final merge preserves an enqueue made from another tab during the request', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const second = (await makeQueueModule({ storage, locks })).module;
	let secondEnqueue: Promise<number> | undefined;
	const first = (
		await makeQueueModule({
			storage,
			locks,
			apiFetch: async () => {
				secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
				return { ok: true, data: {} };
			},
		})
	).module;
	await setQueue(first, [createAction()]);
	assert.equal(
		await first.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		1,
	);
	assert.equal(await secondEnqueue, 2);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => action.id),
		['action-2'],
	);
});

test('concurrent failed queue saves retain every synced marker', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const requestsReady = deferred();
	const responsesReady = deferred();
	let requests = 0;
	let failQueueSave = false;
	storage.setItem = (key, value) => {
		if (failQueueSave && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	const apiFetch = async () => {
		requests += 1;
		if (requests === 2) requestsReady.resolve();
		await responsesReady.promise;
		return { ok: true, data: {} };
	};
	const first = (await makeQueueModule({ storage, locks, apiFetch })).module;
	const second = (await makeQueueModule({ storage, locks, apiFetch })).module;
	await setQueue(first, [createAction(), createAction({ id: 'action-2' })]);
	const syncing = Promise.all([
		first.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		second.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
	]);
	await requestsReady.promise;
	failQueueSave = true;
	responsesReady.resolve();
	await syncing;
	const savedMarkers = JSON.parse(storage.getItem('manawg:offline-synced-ids') ?? 'null');
	assert.deepEqual(Object.keys(savedMarkers).sort(), ['action-1', 'action-2']);
	const reloaded = (await makeQueueModule({ storage, locks })).module;
	assert.equal(reloaded.readOfflineQueue().length, 0);
});

test('401 auth_required stays retryable: no review prefix, no attempt counted, replay stops', async () => {
	let requests = 0;
	const { module, storage } = await makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return { ok: false, status: 401, error: 'auth_required' };
		},
	});
	await setQueue(module, [createAction(), createAction({ id: 'action-2' })]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requests, 1);
	const queue = readStoredQueue(storage);
	assert.deepEqual(
		queue.map((action) => action.id),
		['action-1', 'action-2'],
	);
	assert.equal(queue[0]?.lastError?.startsWith('Server prüfen:'), false);
	assert.equal(queue[0]?.attempts ?? 0, 0);
});

test('entries of an unknown action type survive enqueue and discard', async () => {
	const storage = makeStorage();
	const unknown = { id: 'future-1', type: 'future.thing', payload: { x: 1 } };
	storage.setItem('manawg:offline-actions', JSON.stringify([createAction(), unknown]));
	const { module } = await makeQueueModule({ storage });
	assert.deepEqual(
		module.readOfflineQueue().map((action) => action.id),
		['action-1'],
	);
	assert.equal(await module.enqueueOfflineAction(createAction({ id: 'action-2' })), 2);
	assert.equal(await module.discardQueuedEntry('TEST1234', 'action-1'), 'removed');
	const stored = JSON.parse(storage.getItem('manawg:offline-actions') ?? '[]');
	assert.deepEqual(
		stored.map((entry: { id: string }) => entry.id),
		['action-2', 'future-1'],
	);
	assert.deepEqual(stored[1], unknown);
});

test('removeQueuedAction drops a matching action, keeps one of another type and ignores a missing id', async () => {
	const { module, storage } = await makeQueueModule();
	await setQueue(module, [
		createAction({ id: 'announcement-1' }),
		createAction({
			id: 'chore-1',
			type: 'chore.create',
			payload: { title: 'Bad putzen', intervalDays: 7, assignedMemberId: null },
		}),
	]);
	const ids = () => readStoredQueue(storage).map((action) => action.id);

	assert.equal(await module.removeQueuedAction('chore-1', ['announcement.create']), true);
	assert.deepEqual(ids(), ['announcement-1', 'chore-1']);
	assert.equal(await module.removeQueuedAction('missing'), true);
	assert.deepEqual(ids(), ['announcement-1', 'chore-1']);
	assert.equal(await module.removeQueuedAction('chore-1', ['chore.create']), true);
	assert.deepEqual(ids(), ['announcement-1']);
	assert.equal(await module.removeQueuedAction('announcement-1'), true);
	assert.deepEqual(ids(), []);
});

test('removeQueuedAction reports false when Web Locks are unavailable', async () => {
	const { module } = await makeQueueModule({ locks: null });
	assert.equal(await module.removeQueuedAction('action-1'), false);
});

test('a lost connection stops the replay and backs off only the action it tried', async () => {
	const storage = makeStorage();
	storage.setItem(
		'manawg:offline-actions',
		JSON.stringify([createAction(), createAction({ id: 'action-2' })]),
	);
	let requests = 0;
	const { module } = await makeQueueModule({
		storage,
		apiFetch: async () => {
			requests += 1;
			return { ok: false, status: 0, error: 'Netzwerkfehler' };
		},
	});
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requests, 1);
	assert.deepEqual(
		readStoredQueue(storage).map((action) => [action.id, action.attempts ?? 0]),
		[
			['action-1', 1],
			['action-2', 0],
		],
	);
});
