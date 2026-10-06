import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
	type ApiResult,
	createAction,
	deferred,
	makeLockManager,
	makeQueueModule,
	makeStorage,
	restoreGlobals,
	setQueue,
	storedQueue,
} from './support/offline-queue-harness';

// Queue writes from several tabs of one browser: each tab is an independent copy of the
// offline queue modules over one shared storage and lock manager.

afterEach(restoreGlobals);

test('two tabs preserve both enqueues when the second reads during the first mutation', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = (await makeQueueModule({ storage, locks })).module;
	const second = (await makeQueueModule({ storage, locks })).module;
	const getItem = storage.getItem.bind(storage);
	let secondEnqueue: Promise<number> | undefined;
	storage.getItem = (key: string) => {
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
		storedQueue(storage).map((action) => action.id),
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
		storedQueue(storage).map((action) => action.id),
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
		storedQueue(storage).map((action) => action.id),
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
	assert.equal(storedQueue(storage).length, 1);
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
	storage.getItem = (key: string) => {
		const value = getItem(key);
		if (key === 'manawg:offline-actions' && ++queueReads === 2) {
			secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
		}
		return value;
	};
	assert.equal(await first.discardQueuedEntry('TEST1234', 'action-1'), 'removed');
	assert.equal(await secondEnqueue, 1);
	assert.deepEqual(
		storedQueue(storage).map((action) => action.id),
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
	storage.getItem = (key: string) => {
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
	const queue = storedQueue(storage);
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
		storedQueue(storage).map((action) => action.id),
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
	storage.setItem = (key: string, value: string) => {
		if (failQueueSave && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	const apiFetch = async (): Promise<ApiResult> => {
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
	const savedMarkers = JSON.parse(storage.getItem('manawg:offline-synced-ids') ?? '{}');
	assert.deepEqual(Object.keys(savedMarkers).sort(), ['action-1', 'action-2']);
	const reloaded = (await makeQueueModule({ storage, locks })).module;
	assert.equal(reloaded.readOfflineQueue().length, 0);
});

test('offline data is visible only for the currently bound local account', async () => {
	const identities = new Map([
		['wg-1', { memberId: 'member-a', authUserId: 'user-a' }],
		['wg-2', { memberId: 'member-b' }],
	]);
	const { module } = await makeQueueModule({ identity: (wgId) => identities.get(wgId) ?? null });
	assert.equal(typeof module.filterOfflineActionsForAuthUser, 'function');
	const scoped = [
		createAction(),
		createAction({ id: 'legacy', wgId: 'wg-2', memberId: 'member-b' }),
		createAction({ id: 'unscoped', wgId: undefined }),
	];
	assert.equal(module.filterOfflineActionsForAuthUser(scoped, 'user-a').length, 1);
	assert.equal(module.filterOfflineActionsForAuthUser(scoped, 'user-b').length, 0);
	assert.equal(module.filterOfflineActionsForAuthUser(scoped, null).length, 0);
});

test('a synced queue entry no longer counts as queued for an open queue edit', async () => {
	const { module } = await makeQueueModule({ apiFetch: async () => ({ ok: true, data: {} }) });
	await setQueue(module, [createAction()]);
	assert.equal(module.isOfflineActionQueued('action-1'), true);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(module.isOfflineActionQueued('action-1'), false);
});
