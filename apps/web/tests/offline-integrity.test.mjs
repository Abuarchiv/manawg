import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const webRoot = path.resolve(import.meta.dirname, '..');
const readSource = (relativePath) => readFileSync(path.join(webRoot, relativePath), 'utf8');

// Unmocked relative imports load the sibling once per top-level load, sharing mocks and state.
function loadTs(relativePath, mocks, globals = {}, siblings = new Map()) {
	const source = readSource(relativePath);
	const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
	const js = ts.transpileModule(source, { compilerOptions }).outputText;
	const module = { exports: {} };
	const context = vm.createContext({
		require: (id) => {
			if (Object.hasOwn(mocks, id)) return mocks[id];
			if (id.startsWith('./')) {
				const sibling = path.posix.join(path.posix.dirname(relativePath), `${id.slice(2)}.ts`);
				if (!siblings.has(sibling))
					siblings.set(sibling, loadTs(sibling, mocks, globals, siblings));
				return siblings.get(sibling);
			}
			throw new Error(`Unexpected import ${id} from ${relativePath}`);
		},
		module,
		exports: module.exports,
		Error,
		...globals,
	});
	new vm.Script(js, { filename: relativePath }).runInContext(context);
	return module.exports;
}

const VALID_KEY = '00000000-0000-4000-8000-000000000001';

class FakeCustomEvent {
	constructor(type, init = {}) {
		this.type = type;
		this.detail = init.detail;
	}
}
const { OFFLINE_REPLAY_MAX_AGE_MS, RESPONSE_REPLAY_TTL_SECONDS } = loadTs(
	'src/core/offline/replay-retention.ts',
	{},
);

function createAction(overrides = {}) {
	return {
		id: 'action-1',
		idempotencyKey: VALID_KEY,
		type: 'announcement.create',
		wgId: 'wg-1',
		shareCode: 'TEST1234',
		memberId: 'member-a',
		createdAt: new Date().toISOString(),
		payload: { content: 'original', kind: 'info', imageUrl: null },
		...overrides,
	};
}

function makeStorage() {
	const values = new Map();
	return {
		values,
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, String(value));
		},
		removeItem(key) {
			values.delete(key);
		},
	};
}

function makeLockManager() {
	const tails = new Map();
	return {
		request(name, _options, callback) {
			const previous = tails.get(name) ?? Promise.resolve();
			let release;
			const gate = new Promise((resolve) => {
				release = resolve;
			});
			const tail = previous.then(() => gate);
			tails.set(name, tail);
			return previous.then(callback).finally(() => {
				release();
				if (tails.get(name) === tail) tails.delete(name);
			});
		},
	};
}

function makeQueueModule({
	apiFetch = async () => ({ ok: false, status: 0, error: 'network' }),
	identity = () => ({ memberId: 'member-a' }),
	images = {},
	storage = makeStorage(),
	clock = Date,
	locks = makeLockManager(),
} = {}) {
	const window = { localStorage: storage, dispatchEvent() {} };
	const queue = {
		isOfflineIdempotencyKey: (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
		createOfflineIdempotencyKey: () => VALID_KEY,
		isQueuedCreateId: (value) =>
			typeof value === 'string' && /^(?:shopping|chore-create|absence):/.test(value),
		explainOfflineActionFailure: (status, error) => ({
			title: 'Fehler',
			detail: `${status}:${error ?? ''}`,
		}),
		getOfflineActionRequest: (action) => ({
			path: `/api/wg/${action.shareCode}/actions`,
			method: action.type === 'shopping.update' ? 'PATCH' : 'POST',
			body: action.payload,
		}),
		serializeOfflineAction: (action) => JSON.stringify(action),
		shouldRetryOfflineAction: () => true,
		withoutQueuedEntry: (actions, shareCode, id) => {
			if (!actions.some((action) => action.shareCode === shareCode && action.id === id))
				return null;
			return actions.filter((action) => action.id !== id || action.shareCode !== shareCode);
		},
	};
	const module = loadTs(
		'src/core/offline/offline-client.ts',
		{
			'@/core/utils/is-record': loadTs('src/core/utils/is-record.ts', {}),
			'@/core/infra/api-client': { apiFetch },
			'@/core/utils/browser': { safeLocalStorage: () => window.localStorage },
			'@/core/auth/identity': { getIdentity: identity },
			'./offline-images': {
				isPendingImageToken: (value) =>
					typeof value === 'string' && value.startsWith('manawg-pending-image:'),
				uploadPendingImageToken: async () => 'https://app.invalid/image',
				removePendingImage: async () => {},
				...images,
			},
			'./offline-queue': queue,
			'./replay-retention': loadTs('src/core/offline/replay-retention.ts', {}),
		},
		{
			window,
			CustomEvent: FakeCustomEvent,
			Date: clock,
			Math,
			AbortSignal,
			navigator: locks ? { locks } : {},
			process,
		},
	);
	return { module, storage, window };
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function setQueue(module, actions) {
	assert.equal(await module.updateOfflineQueue(() => actions), true);
}

test('two tabs preserve both enqueues when the second reads during the first mutation', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = makeQueueModule({ storage, locks }).module;
	const second = makeQueueModule({ storage, locks }).module;
	const getItem = storage.getItem.bind(storage);
	let secondEnqueue;
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
		JSON.parse(storage.getItem('manawg:offline-actions')).map((action) => action.id),
		['action-1', 'action-2'],
	);
});

test('same-tab concurrent enqueues keep every action', async () => {
	const { module, storage } = makeQueueModule();
	await Promise.all(
		Array.from({ length: 8 }, (_, index) =>
			module.enqueueOfflineAction(createAction({ id: `action-${index}` })),
		),
	);
	assert.deepEqual(
		JSON.parse(storage.getItem('manawg:offline-actions')).map((action) => action.id),
		Array.from({ length: 8 }, (_, index) => `action-${index}`),
	);
});

test('queue writes and sync fail closed when Web Locks are unavailable', async () => {
	const storage = makeStorage();
	storage.setItem('manawg:offline-actions', JSON.stringify([createAction()]));
	let requests = 0;
	const { module } = makeQueueModule({
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
		JSON.parse(storage.getItem('manawg:offline-actions')).map((action) => action.id),
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
	const { module } = makeQueueModule({ storage, locks: null });
	assert.equal(await module.discardQueuedEntry('TEST1234', serverItemId), 'storage_blocked');
	assert.equal(JSON.parse(storage.getItem('manawg:offline-actions')).length, 1);
});

test('discard during a second-tab enqueue preserves the new action', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = makeQueueModule({ storage, locks }).module;
	const second = makeQueueModule({ storage, locks }).module;
	await setQueue(first, [createAction()]);
	const getItem = storage.getItem.bind(storage);
	let queueReads = 0;
	let secondEnqueue;
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
		JSON.parse(storage.getItem('manawg:offline-actions')).map((action) => action.id),
		['action-2'],
	);
});

test('edit during a second-tab enqueue preserves both the edit and new action', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const first = makeQueueModule({ storage, locks }).module;
	const second = makeQueueModule({ storage, locks }).module;
	await setQueue(first, [createAction()]);
	const getItem = storage.getItem.bind(storage);
	let secondEnqueue;
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
	const queue = JSON.parse(storage.getItem('manawg:offline-actions'));
	assert.equal(queue.find((action) => action.id === 'action-1').payload.content, 'edited');
	assert.deepEqual(
		queue.map((action) => action.id),
		['action-1', 'action-2'],
	);
});

test('sync final merge preserves an enqueue made from another tab during the request', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const second = makeQueueModule({ storage, locks }).module;
	let secondEnqueue;
	const first = makeQueueModule({
		storage,
		locks,
		apiFetch: async () => {
			secondEnqueue = second.enqueueOfflineAction(createAction({ id: 'action-2' }));
			return { ok: true, data: {} };
		},
	}).module;
	await setQueue(first, [createAction()]);
	assert.equal(
		await first.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		1,
	);
	assert.equal(await secondEnqueue, 2);
	assert.deepEqual(
		JSON.parse(storage.getItem('manawg:offline-actions')).map((action) => action.id),
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
	const first = makeQueueModule({ storage, locks, apiFetch }).module;
	const second = makeQueueModule({ storage, locks, apiFetch }).module;
	await setQueue(first, [createAction(), createAction({ id: 'action-2' })]);
	const syncing = Promise.all([
		first.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		second.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
	]);
	await requestsReady.promise;
	failQueueSave = true;
	responsesReady.resolve();
	await syncing;
	const savedMarkers = JSON.parse(storage.getItem('manawg:offline-synced-ids'));
	assert.deepEqual(Object.keys(savedMarkers).sort(), ['action-1', 'action-2']);
	const reloaded = makeQueueModule({ storage, locks }).module;
	assert.equal(reloaded.readOfflineQueue().length, 0);
});

test('expired replay windows fence automatic and forced sync before upload or mutation', async () => {
	const now = Date.parse('2026-10-10T12:00:00Z');
	class Clock extends Date {
		static now() {
			return now;
		}
	}
	for (const force of [false, true]) {
		for (const attempts of [undefined, 3]) {
			let requests = 0;
			let uploads = 0;
			const storage = makeStorage();
			const { module } = makeQueueModule({
				clock: Clock,
				storage,
				apiFetch: async () => {
					requests += 1;
					return { ok: true, data: {} };
				},
				images: {
					uploadPendingImageToken: async () => {
						uploads += 1;
						return 'https://app.invalid/image';
					},
				},
			});
			const action = createAction({
				type: 'expense.create',
				createdAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
				...(attempts === undefined
					? {}
					: { attempts, lastAttemptAt: new Date(now - 1000).toISOString() }),
				payload: {
					description: 'Old expense',
					amountCents: 100,
					paidByMemberId: 'member-a',
					splits: [{ debtorMemberId: 'member-b', amountCents: 100 }],
					imageUrl: 'manawg-pending-image:receipt',
				},
			});
			// Direct storage models a crash before attempts/lastAttemptAt could be persisted.
			storage.setItem('manawg:offline-actions', JSON.stringify([action]));
			assert.equal(await module.syncOfflineActions('TEST1234', { memberId: 'member-a', force }), 0);
			assert.equal(requests, 0);
			assert.equal(uploads, 0);
			const retained = module.readOfflineQueue()[0];
			assert.equal(retained.idempotencyKey, action.idempotencyKey);
			assert.equal(JSON.stringify(retained.payload), JSON.stringify(action.payload));
			assert.match(retained.lastError, /^Server prüfen:/);
			assert.match(retained.lastError, /Wiederholungsfrist ist abgelaufen/);
			assert.equal(module.needsManualOfflineResolution(retained), true);
		}
	}
});

test('replay fence includes the retention boundary and invalid clocks but tolerates small future skew', async () => {
	const now = Date.parse('2026-10-10T12:00:00Z');
	class Clock extends Date {
		static now() {
			return now;
		}
	}
	for (const [createdAt, expectedRequests] of [
		[new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), 0],
		[new Date(now - RESPONSE_REPLAY_TTL_SECONDS * 1000 + 1).toISOString(), 0],
		[new Date(now - OFFLINE_REPLAY_MAX_AGE_MS).toISOString(), 0],
		[new Date(now - OFFLINE_REPLAY_MAX_AGE_MS + 1).toISOString(), 1],
		['invalid', 0],
		[new Date(now + 24 * 60 * 60 * 1000).toISOString(), 0],
		[new Date(now + 60 * 1000).toISOString(), 1],
	]) {
		let requests = 0;
		const { module } = makeQueueModule({
			clock: Clock,
			apiFetch: async () => {
				requests += 1;
				return { ok: true, data: {} };
			},
		});
		await setQueue(module, [createAction({ createdAt })]);
		await module.syncOfflineActions('TEST1234', { memberId: 'member-a', force: true });
		assert.equal(requests, expectedRequests, createdAt);
	}
});

test('replay window is rechecked after an upload crosses the deadline', async () => {
	let now = Date.parse('2026-10-10T12:00:00Z');
	class Clock extends Date {
		static now() {
			return now;
		}
	}
	let requests = 0;
	const { module } = makeQueueModule({
		clock: Clock,
		apiFetch: async () => {
			requests += 1;
			return { ok: true, data: {} };
		},
		images: {
			uploadPendingImageToken: async () => {
				now += 2;
				return 'https://app.invalid/image';
			},
		},
	});
	await setQueue(module, [
		createAction({
			createdAt: new Date(now - OFFLINE_REPLAY_MAX_AGE_MS + 1).toISOString(),
			payload: { content: 'receipt', kind: 'info', imageUrl: 'manawg-pending-image:receipt' },
		}),
	]);
	await module.syncOfflineActions('TEST1234', { memberId: 'member-a', force: true });
	assert.equal(requests, 0);
	assert.equal(module.readOfflineQueue().length, 1);
	assert.match(module.readOfflineQueue()[0].lastError, /^Server prüfen:/);
});

test('sync does not resurrect an action deleted while its request waits', async () => {
	const entered = deferred();
	const response = deferred();
	const { module } = makeQueueModule({
		apiFetch: async () => {
			entered.resolve();
			return response.promise;
		},
	});
	await setQueue(module, [createAction()]);
	const syncing = module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	await entered.promise;
	await setQueue(module, []);
	response.resolve({ ok: false, status: 0, error: 'network' });
	await syncing;
	assert.equal(module.readOfflineQueue().length, 0);
});

test('sync preserves an action edit made while its request waits', async () => {
	const entered = deferred();
	const response = deferred();
	let requestCount = 0;
	const { module } = makeQueueModule({
		apiFetch: async () => {
			requestCount += 1;
			entered.resolve();
			return response.promise;
		},
	});
	await setQueue(module, [createAction()]);
	const syncing = module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	await entered.promise;
	await setQueue(module, [
		createAction({ payload: { content: 'edited', kind: 'info', imageUrl: null } }),
	]);
	response.resolve({ ok: false, status: 0, error: 'network' });
	await syncing;
	assert.equal(module.readOfflineQueue()[0].payload.content, 'edited');
	assert.match(module.readOfflineQueue()[0].lastError, /^Server prüfen:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 1);
});

test('a successful old request cannot hide a concurrent edit when final storage save fails', async () => {
	const entered = deferred();
	const response = deferred();
	const storage = makeStorage();
	let failQueueSave = false;
	storage.setItem = (key, value) => {
		if (failQueueSave && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	const { module } = makeQueueModule({
		storage,
		apiFetch: async () => {
			entered.resolve();
			return response.promise;
		},
	});
	await setQueue(module, [createAction()]);
	const syncing = module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	await entered.promise;
	await setQueue(module, [
		createAction({ payload: { content: 'edited', kind: 'info', imageUrl: null } }),
	]);
	failQueueSave = true;
	response.resolve({ ok: true, data: undefined });
	await syncing;
	const edited = module.readOfflineQueue()[0];
	assert.equal(edited.payload.content, 'edited');
	assert.equal(edited.idempotencyKey, VALID_KEY);
	assert.match(edited.lastError, /^Server prüfen:/);
	const reloaded = makeQueueModule({
		storage,
		apiFetch: async () => {
			throw new Error('review-required action must not replay');
		},
	});
	assert.match(reloaded.module.readOfflineQueue()[0].lastError, /^Server prüfen:/);
	await reloaded.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	failQueueSave = false;
	await setQueue(reloaded.module, []);
	assert.equal(storage.getItem('manawg:offline-review-ids'), '{}');
	await setQueue(reloaded.module, [
		createAction({ payload: { content: 'replacement', kind: 'info', imageUrl: null } }),
	]);
	assert.equal(reloaded.module.readOfflineQueue()[0].lastError, undefined);
});

test('failed final queue read marks a successful action for review after storage recovers', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const getItem = storage.getItem.bind(storage);
	let failQueueRead = false;
	let requests = 0;
	storage.getItem = (key) => {
		if (failQueueRead && key === 'manawg:offline-actions')
			throw new Error('temporary read failure');
		return getItem(key);
	};
	const { module } = makeQueueModule({
		storage,
		locks,
		apiFetch: async () => {
			requests += 1;
			failQueueRead = true;
			return { ok: true, data: undefined };
		},
	});
	await setQueue(module, [createAction()]);
	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		1,
	);
	failQueueRead = false;
	const recovered = module.readOfflineQueue()[0];
	assert.equal(recovered.payload.content, 'original');
	assert.match(recovered.lastError, /^Server prüfen:/);
	assert.equal(module.needsManualOfflineResolution(recovered), true);
	assert.equal(
		await module.updateOfflineQueue((actions) =>
			actions.map((action) =>
				action.id === 'action-1'
					? { ...action, payload: { ...action.payload, content: 'edited' } }
					: action,
			),
		),
		true,
	);
	assert.equal(module.readOfflineQueue()[0].payload.content, 'edited');
	assert.match(module.readOfflineQueue()[0].lastError, /^Server prüfen:/);
	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		0,
	);
	assert.equal(requests, 1);
});

test('failed final save keeps an expense when its recurring follow-up was not persisted', async () => {
	const storage = makeStorage();
	let primaryRequestDone = false;
	storage.setItem = (key, value) => {
		if (primaryRequestDone && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	let calls = 0;
	const { module } = makeQueueModule({
		storage,
		apiFetch: async (_path, init) => {
			calls += 1;
			if (init.method === 'PATCH') return { ok: false, status: 503, error: 'unavailable' };
			primaryRequestDone = true;
			return { ok: true, data: undefined };
		},
	});
	await setQueue(module, [
		createAction({
			type: 'expense.create',
			payload: {
				description: 'Miete',
				amountCents: 100,
				paidByMemberId: 'member-a',
				splits: [{ debtorMemberId: 'member-a', amountCents: 100 }],
				imageUrl: null,
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			},
		}),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(calls, 2);
	assert.equal(module.readOfflineQueue().length, 1);
	assert.equal(module.readOfflineQueue()[0].type, 'expense.create');
});

test('a recurring advance action is not followed by a second advance request', async () => {
	let calls = 0;
	const { module } = makeQueueModule({
		apiFetch: async () => {
			calls += 1;
			return { ok: true, data: undefined };
		},
	});
	await setQueue(module, [
		createAction({
			type: 'recurring.advance',
			payload: {
				recurringExpenseId: 'recurring-1',
				expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
			},
		}),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(calls, 1);
});

test('queued PATCH keeps its idempotency key and expected member in the request', async () => {
	let request;
	const { module } = makeQueueModule({
		apiFetch: async (_path, init) => {
			request = init;
			return { ok: true, data: undefined };
		},
	});
	await setQueue(module, [
		createAction({
			type: 'shopping.update',
			payload: {
				itemId: 'item-1',
				name: 'Milch',
				bought: true,
				expectedUpdatedAt: '2026-09-27T09:00:00.000Z',
				expectedBoughtAt: null,
			},
		}),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(request.headers['Idempotency-Key'], VALID_KEY);
	assert.equal(request.memberId, 'member-a');
});

test('resolved upload URL is persisted to the queue before its IndexedDB blob is deleted', async () => {
	const pendingToken = 'manawg-pending-image:pic';
	const publicUrl = 'https://app.invalid/api/upload/read?key=uploaded';
	const records = new Map([
		[
			'pic',
			{
				id: 'pic',
				file: new Blob(['abc'], { type: 'image/png' }),
				name: 'pic.png',
				type: 'image/png',
				size: 3,
				shareCode: 'TEST1234',
				memberId: 'member-a',
				purpose: 'announcement',
				createdAt: '2026-09-27T10:00:00.000Z',
			},
		],
	]);
	const indexedDB = {
		open() {
			const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
			request.result = {
				objectStoreNames: { contains: () => true },
				createObjectStore() {},
				close() {},
				transaction() {
					const tx = { oncomplete: null, onerror: null, error: null };
					const makeRequest = (run) => {
						const req = { result: undefined, error: null, onsuccess: null, onerror: null };
						queueMicrotask(() => {
							try {
								req.result = run();
								req.onsuccess?.();
								queueMicrotask(() => tx.oncomplete?.());
							} catch (error) {
								req.error = error;
								tx.error = error;
								req.onerror?.();
								tx.onerror?.();
							}
						});
						return req;
					};
					tx.objectStore = () => ({
						get: (key) => makeRequest(() => records.get(key)),
						put: (value, key) =>
							makeRequest(() => {
								records.set(key, value);
								return key;
							}),
						delete: (key) => makeRequest(() => records.delete(key)),
					});
					return tx;
				},
			};
			queueMicrotask(() => request.onsuccess?.());
			return request;
		},
	};
	const storage = makeStorage();
	const localStorage = storage;
	const locks = makeLockManager();
	const window = { localStorage, dispatchEvent() {} };
	const images = loadTs(
		'src/core/offline/offline-images.ts',
		{
			'./offline-queue': { createOfflineIdempotencyKey: () => VALID_KEY },
			'@/shared/lib/member-header': { EXPECTED_MEMBER_ID_HEADER: 'x-manawg-expected-member-id' },
		},
		{
			window,
			indexedDB,
			Blob,
			fetch: async (url) =>
				url === '/api/upload/sign'
					? Response.json({
							presignedUrl: 'https://storage.invalid/upload',
							publicUrl,
							maxFileSize: 100,
						})
					: new Response(null, { status: 200 }),
			Response,
			queueMicrotask,
		},
	);
	let queueAtRequest;
	const module = loadTs(
		'src/core/offline/offline-client.ts',
		{
			'@/core/utils/is-record': loadTs('src/core/utils/is-record.ts', {}),
			'@/core/utils/browser': { safeLocalStorage: () => window.localStorage },
			'@/core/infra/api-client': {
				apiFetch: async (_path, init) => {
					queueAtRequest = JSON.parse(localStorage.getItem('manawg:offline-actions'));
					return { ok: false, status: 0, error: 'network', signal: init.signal };
				},
			},
			'@/core/auth/identity': { getIdentity: () => ({ memberId: 'member-a' }) },
			'./offline-images': images,
			'./replay-retention': loadTs('src/core/offline/replay-retention.ts', {}),
			'./offline-queue': {
				isOfflineIdempotencyKey: (value) => value === VALID_KEY,
				createOfflineIdempotencyKey: () => VALID_KEY,
				explainOfflineActionFailure: () => ({ title: 'Fehler', detail: 'Netzwerk' }),
				getOfflineActionRequest: (action) => ({
					path: '/api/wg/TEST1234/announcements',
					method: 'POST',
					body: action.payload,
				}),
				serializeOfflineAction: (action) => JSON.stringify(action),
				shouldRetryOfflineAction: () => true,
			},
		},
		{
			window,
			indexedDB,
			Blob,
			Response,
			CustomEvent: FakeCustomEvent,
			Date,
			Math,
			AbortSignal,
			navigator: { locks },
			process,
		},
	);
	await setQueue(module, [
		createAction({ payload: { content: 'with image', kind: 'info', imageUrl: pendingToken } }),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(queueAtRequest[0].payload.imageUrl, publicUrl);
	assert.equal(module.readOfflineQueue()[0].payload.imageUrl, publicUrl);
	assert.equal(records.has('pic'), false);
});

test('delete or edit during attachment cleanup stops the stale network request', async () => {
	for (const change of ['delete', 'edit']) {
		const cleanupStarted = deferred();
		const cleanupRelease = deferred();
		let requestCount = 0;
		const { module } = makeQueueModule({
			apiFetch: async () => {
				requestCount += 1;
				return { ok: true, data: undefined };
			},
			images: {
				uploadPendingImageToken: async () => 'https://app.invalid/image',
				removePendingImage: async () => {
					cleanupStarted.resolve();
					await cleanupRelease.promise;
				},
			},
		});
		await setQueue(module, [
			createAction({
				payload: { content: 'original', kind: 'info', imageUrl: 'manawg-pending-image:pic' },
			}),
		]);
		const syncing = module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
		await cleanupStarted.promise;
		if (change === 'delete') {
			await setQueue(module, []);
		} else {
			const current = module.readOfflineQueue()[0];
			await setQueue(module, [{ ...current, payload: { ...current.payload, content: 'edited' } }]);
		}
		cleanupRelease.resolve();
		await syncing;
		assert.equal(requestCount, 0);
	}
});

test('edit during image upload keeps the replacement and does not send the stale snapshot', async () => {
	const uploadStarted = deferred();
	const uploadResponse = deferred();
	let requests = 0;
	let removals = 0;
	const { module } = makeQueueModule({
		apiFetch: async () => {
			requests += 1;
			return { ok: true, data: undefined };
		},
		images: {
			uploadPendingImageToken: async () => {
				uploadStarted.resolve();
				return uploadResponse.promise;
			},
			removePendingImage: async () => {
				removals += 1;
			},
		},
	});
	await setQueue(module, [
		createAction({
			payload: { content: 'original', kind: 'info', imageUrl: 'manawg-pending-image:pic' },
		}),
	]);
	const syncing = module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	await uploadStarted.promise;
	assert.equal(
		await module.updateOfflineQueue((actions) =>
			actions.map((action) =>
				action.id === 'action-1'
					? { ...action, payload: { ...action.payload, content: 'edited' } }
					: action,
			),
		),
		true,
	);
	uploadResponse.resolve('https://app.invalid/image');
	await syncing;
	assert.equal(requests, 0);
	assert.equal(removals, 0);
	assert.equal(module.readOfflineQueue()[0].payload.content, 'edited');
	assert.equal(module.readOfflineQueue()[0].payload.imageUrl, 'manawg-pending-image:pic');
});

test('aborting after an auth change stops later requests and keeps all queue entries', async () => {
	const entered = deferred();
	let requestCount = 0;
	const { module } = makeQueueModule({
		apiFetch: async (_path, init) => {
			requestCount += 1;
			entered.resolve();
			return new Promise((resolve) => {
				init.signal.addEventListener(
					'abort',
					() => resolve({ ok: false, status: 0, error: 'aborted' }),
					{ once: true },
				);
			});
		},
	});
	await setQueue(module, [
		createAction(),
		createAction({ id: 'action-2', payload: { content: 'second', kind: 'info', imageUrl: null } }),
	]);
	const controller = new AbortController();
	const syncing = module.syncOfflineActions('TEST1234', {
		force: true,
		memberId: 'member-a',
		signal: controller.signal,
	});
	await entered.promise;
	controller.abort();
	await syncing;
	assert.equal(requestCount, 1);
	assert.equal(module.readOfflineQueue().length, 2);
});

test('missing and revoked image blobs stay visible and are never silently dropped', async () => {
	let requestCount = 0;
	const pendingAction = createAction({
		payload: { content: 'with image', kind: 'info', imageUrl: 'manawg-pending-image:missing' },
	});
	const { module } = makeQueueModule({
		apiFetch: async () => {
			requestCount += 1;
			return { ok: true, data: undefined };
		},
		images: {
			uploadPendingImageToken: async () => {
				throw new Error('pending-image-missing');
			},
		},
	});
	await setQueue(module, [pendingAction]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(module.readOfflineQueue()[0].payload.imageUrl, 'manawg-pending-image:missing');
	assert.match(module.readOfflineQueue()[0].lastError, /^Bild fehlt:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 0);
	await setQueue(module, [
		{
			...module.readOfflineQueue()[0],
			payload: { ...module.readOfflineQueue()[0].payload, imageUrl: null },
		},
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 1);

	let revokedRequests = 0;
	const revoked = makeQueueModule({
		apiFetch: async () => {
			revokedRequests += 1;
			return { ok: true, data: undefined };
		},
		images: {
			uploadPendingImageToken: async () => {
				throw new Error('sign-failed:409:image_removed');
			},
		},
	});
	await setQueue(revoked.module, [
		createAction({
			id: 'revoked',
			payload: { content: 'with image', kind: 'info', imageUrl: 'manawg-pending-image:revoked' },
		}),
	]);
	await revoked.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.match(revoked.module.readOfflineQueue()[0].lastError, /^Bild wurde entfernt:/);
	await revoked.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(revokedRequests, 0);
});

test('server image_removed retains payload and supports explicit removal after rejection', async () => {
	const publicUrl = 'https://app.invalid/api/upload/read?key=revoked';
	let requestCount = 0;
	const { module } = makeQueueModule({
		apiFetch: async () => {
			requestCount += 1;
			return requestCount === 1
				? { ok: false, status: 409, error: 'image_removed' }
				: { ok: true, data: undefined };
		},
	});
	await setQueue(module, [
		createAction({ payload: { content: 'with image', kind: 'info', imageUrl: publicUrl } }),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	const blocked = module.readOfflineQueue()[0];
	assert.equal(blocked.payload.imageUrl, publicUrl);
	assert.match(blocked.lastError, /^Bild wurde entfernt:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 1);
	await setQueue(module, [{ ...blocked, payload: { ...blocked.payload, imageUrl: null } }]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 2);
	assert.equal(module.readOfflineQueue().length, 0);

	const entered = deferred();
	const response = deferred();
	let racedRequestCount = 0;
	const raced = makeQueueModule({
		apiFetch: async () => {
			racedRequestCount += 1;
			if (racedRequestCount === 1) {
				entered.resolve();
				return response.promise;
			}
			return { ok: true, data: undefined };
		},
	});
	await setQueue(raced.module, [
		createAction({ payload: { content: 'with image', kind: 'info', imageUrl: publicUrl } }),
	]);
	const syncing = raced.module.syncOfflineActions('TEST1234', {
		force: true,
		memberId: 'member-a',
	});
	await entered.promise;
	const current = raced.module.readOfflineQueue()[0];
	await setQueue(raced.module, [{ ...current, payload: { ...current.payload, imageUrl: null } }]);
	response.resolve({ ok: false, status: 409, error: 'image_removed' });
	await syncing;
	assert.equal(raced.module.readOfflineQueue()[0].payload.imageUrl, null);
	assert.doesNotMatch(raced.module.readOfflineQueue()[0].lastError ?? '', /^Server prüfen:/);
	await raced.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(racedRequestCount, 2);
	assert.equal(raced.module.readOfflineQueue().length, 0);
});

test('API client sends only the expected member header, never a member id or token', async () => {
	let sentHeaders;
	let sentSignal;
	const api = loadTs(
		'src/core/infra/api-client.ts',
		{
			'@/shared/lib/member-header': {
				EXPECTED_MEMBER_ID_HEADER: 'x-manawg-expected-member-id',
			},
		},
		{
			fetch: async (_path, init) => {
				sentHeaders = new Headers(init.headers);
				sentSignal = init.signal;
				return new Response(null, { status: 204 });
			},
			Headers,
			AbortSignal,
			process: { env: {} },
		},
	);
	const controller = new AbortController();
	await api.apiFetch('/api/wg/TEST1234/announcements', {
		method: 'POST',
		memberId: 'member-a',
		body: '{}',
		signal: controller.signal,
	});
	assert.equal(sentHeaders.get('x-manawg-expected-member-id'), 'member-a');
	assert.equal(sentHeaders.has('x-manawg-member-id'), false);
	assert.equal(sentHeaders.has('x-manawg-member-token'), false);
	assert.notEqual(sentSignal, controller.signal);
	controller.abort();
	assert.equal(sentSignal.aborted, true);
});

test('server guard rejects a stale expected member only after cookie membership lookup', async () => {
	let authenticated = false;
	let membershipResolved = false;
	const guard = loadTs('src/core/guards/api-auth.ts', {
		'@/core/auth/server': {
			getAuthenticatedUser: async () => {
				authenticated = true;
				return { id: 'user-a' };
			},
		},
		'@/core/db': {
			db: {
				query: {
					wgMembers: {
						findFirst: async () => {
							membershipResolved = true;
							return { id: 'member-a', name: 'A', deactivatedAt: null };
						},
					},
				},
			},
			wgMembers: {},
		},
		'@/core/http/api-errors': {
			HTTP: { UNAUTHORIZED: 401, CONFLICT: 409, SERVICE_UNAVAILABLE: 503 },
			apiError: (code, status) => ({ code, status }),
		},
		'@/core/infra/observability': { logApiError() {} },
		'@/shared/lib/member-header': {
			EXPECTED_MEMBER_ID_HEADER: 'x-manawg-expected-member-id',
		},
		'drizzle-orm': { and: (...args) => args, eq: (...args) => args },
	});
	const result = await guard.requireMember(
		{
			method: 'POST',
			headers: { get: (name) => (name === 'x-manawg-expected-member-id' ? 'member-b' : null) },
		},
		'wg-1',
	);
	assert.equal(authenticated, true);
	assert.equal(membershipResolved, true);
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'member_context_changed');
	assert.deepEqual(result.response, { code: 'member_context_changed', status: 409 });
	const matching = await guard.requireMember(
		{
			method: 'POST',
			headers: { get: (name) => (name === 'x-manawg-expected-member-id' ? 'member-a' : null) },
		},
		'wg-1',
	);
	assert.equal(matching.ok, true);
	assert.equal(matching.member.memberId, 'member-a');
});

test('offline data is visible only for the currently bound local account', () => {
	const identities = new Map([
		['wg-1', { memberId: 'member-a', authUserId: 'user-a' }],
		['wg-2', { memberId: 'member-b' }],
	]);
	const { module } = makeQueueModule({ identity: (wgId) => identities.get(wgId) ?? null });
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
	const { module } = makeQueueModule({ apiFetch: async () => ({ ok: true, data: {} }) });
	await setQueue(module, [createAction()]);
	assert.equal(module.isOfflineActionQueued('action-1'), true);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(module.isOfflineActionQueued('action-1'), false);
});
