import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
	type Action,
	createAction,
	deferred,
	makeQueueModule,
	makeStorage,
	PendingImageMissingError,
	readStoredQueue,
	restoreGlobals,
	setGlobal,
	setQueue,
} from './support/offline-harness.ts';

// biome-ignore lint/suspicious/noExplicitAny: hand-rolled IndexedDB fake
type Loose = any;

afterEach(restoreGlobals);

function fakeIndexedDb(
	records: Map<string, Loose>,
	beforeGetAllKeys?: () => void,
	afterPut?: () => void,
) {
	return {
		open() {
			const request: Loose = {
				result: null,
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
			};
			request.result = {
				objectStoreNames: { contains: () => true },
				createObjectStore() {},
				close() {},
				transaction() {
					const before = new Map(records);
					let aborted = false;
					const tx: Loose = {
						oncomplete: null,
						onerror: null,
						onabort: null,
						error: null,
						abort() {
							if (aborted) return;
							aborted = true;
							records.clear();
							for (const [key, value] of before) records.set(key, value);
							this.error = new DOMException('transaction aborted', 'AbortError');
							queueMicrotask(() => this.onabort?.());
						},
					};
					const makeRequest = (run: () => unknown) => {
						const req: Loose = { result: undefined, error: null, onsuccess: null, onerror: null };
						queueMicrotask(() => {
							if (aborted) return;
							try {
								req.result = run();
								req.onsuccess?.();
								if (!aborted) queueMicrotask(() => !aborted && tx.oncomplete?.());
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
						get: (key: string) => makeRequest(() => records.get(key)),
						getAllKeys: () =>
							makeRequest(() => {
								beforeGetAllKeys?.();
								return [...records.keys()];
							}),
						put: (value: Loose, key: string) =>
							makeRequest(() => {
								records.set(key, value);
								afterPut?.();
								return key;
							}),
						delete: (key: string) => makeRequest(() => records.delete(key)),
						count: () => makeRequest(() => records.size),
					});
					return tx;
				},
			};
			queueMicrotask(() => request.onsuccess?.());
			return request;
		},
	};
}

test('pending image cleanup stops after account changes while reading keys', async () => {
	const storage = makeStorage();
	storage.setItem('manawg_account', 'account-a');
	setGlobal('window', { localStorage: storage });
	const records = new Map<string, Loose>([['account-a-image', { id: 'account-a-image' }]]);
	setGlobal(
		'indexedDB',
		fakeIndexedDb(records, () => {
			records.set('account-b-image', { id: 'account-b-image' });
			storage.setItem('manawg_account', 'account-b');
		}),
	);
	const { clearPendingImages } = await import('../src/core/offline/offline-images.ts');

	assert.equal(await clearPendingImages('account-a'), false);
	assert.equal(records.has('account-a-image'), true);
	assert.equal(records.has('account-b-image'), true);
});

test('pending image cleanup removes its key snapshot while the account stays current', async () => {
	const storage = makeStorage();
	storage.setItem('manawg_account', 'account-a');
	setGlobal('window', { localStorage: storage });
	const records = new Map<string, Loose>([
		['account-a-image-1', { id: 'account-a-image-1' }],
		['account-a-image-2', { id: 'account-a-image-2' }],
	]);
	setGlobal('indexedDB', fakeIndexedDb(records));
	const { clearPendingImages } = await import('../src/core/offline/offline-images.ts');

	assert.equal(await clearPendingImages('account-a'), true);
	assert.equal(records.size, 0);
});

test('storePendingImage rolls back if account changes during its IndexedDB write', async () => {
	const storage = makeStorage();
	storage.setItem('manawg_account', 'account-a');
	const windowTarget = Object.assign(new EventTarget(), { localStorage: storage });
	setGlobal('window', windowTarget);
	const records = new Map<string, Loose>();
	setGlobal(
		'indexedDB',
		fakeIndexedDb(records, undefined, () => {
			storage.setItem('manawg_account', 'account-b');
			windowTarget.dispatchEvent(new Event('storage'));
		}),
	);
	const { storePendingImage } = await import('../src/core/offline/offline-images.ts');

	await assert.rejects(
		storePendingImage({
			file: new File(['account-a image'], 'a.png', { type: 'image/png' }),
			shareCode: 'TEST1234',
			memberId: 'member-a',
			purpose: 'expense',
		}),
		{ name: 'AbortError' },
	);
	assert.equal(records.size, 0);
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
	const indexedDB = fakeIndexedDb(records);
	setGlobal('indexedDB', indexedDB);
	setGlobal('fetch', async (url: string) =>
		url === '/api/upload/sign'
			? Response.json({
					presignedUrl: 'https://storage.invalid/upload',
					publicUrl,
					maxFileSize: 100,
				})
			: new Response(null, { status: 200 }),
	);
	const storage = makeStorage();
	let queueAtRequest: Action[] | undefined;
	const { module } = await makeQueueModule({
		storage,
		// The real image store runs against the fake IndexedDB above.
		images: null,
		apiFetch: async (_path, init) => {
			queueAtRequest = readStoredQueue(storage);
			return { ok: false, status: 0, error: 'network', signal: init.signal };
		},
	});
	await setQueue(module, [
		createAction({ payload: { content: 'with image', kind: 'info', imageUrl: pendingToken } }),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(queueAtRequest?.[0]?.payload.imageUrl, publicUrl);
	assert.equal(module.readOfflineQueue()[0].payload.imageUrl, publicUrl);
	assert.equal(records.has('pic'), false);
});

test('delete or edit during attachment cleanup stops the stale network request', async () => {
	for (const change of ['delete', 'edit']) {
		const cleanupStarted = deferred();
		const cleanupRelease = deferred();
		let requestCount = 0;
		const { module } = await makeQueueModule({
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
	const { module } = await makeQueueModule({
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
	const { module } = await makeQueueModule({
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
	const { module } = await makeQueueModule({
		apiFetch: async () => {
			requestCount += 1;
			return { ok: true, data: undefined };
		},
		images: {
			uploadPendingImageToken: async () => {
				throw new PendingImageMissingError();
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
	const revoked = await makeQueueModule({
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
	const { module } = await makeQueueModule({
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
	const raced = await makeQueueModule({
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
	let sentHeaders: Headers | undefined;
	let sentSignal: AbortSignal | undefined;
	setGlobal('fetch', async (_path: string, init: RequestInit) => {
		sentHeaders = new Headers(init.headers);
		sentSignal = init.signal as AbortSignal;
		return new Response(null, { status: 204 });
	});
	const api = await import('../src/core/infra/api-client.ts');
	const controller = new AbortController();
	await api.apiFetch('/api/wg/TEST1234/announcements', {
		method: 'POST',
		memberId: 'member-a',
		body: '{}',
		signal: controller.signal,
	});
	assert.equal(sentHeaders?.get('x-manawg-expected-member-id'), 'member-a');
	assert.equal(sentHeaders?.has('x-manawg-member-id'), false);
	assert.equal(sentHeaders?.has('x-manawg-member-token'), false);
	assert.notEqual(sentSignal, controller.signal);
	controller.abort();
	assert.equal(sentSignal?.aborted, true);
});

test('server guard rejects a stale expected member only after cookie membership lookup', async () => {
	let authenticated = false;
	let membershipResolved = false;
	mock.module('@/core/auth/server', {
		namedExports: {
			getAuthenticatedUser: async () => {
				authenticated = true;
				return { id: 'user-a' };
			},
		},
	});
	mock.module('@/core/db', {
		namedExports: {
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
	});
	mock.module('@/core/http/api-errors', {
		namedExports: {
			HTTP: { UNAUTHORIZED: 401, CONFLICT: 409, SERVICE_UNAVAILABLE: 503 },
			apiError: (code: string, status: number) => ({ code, status }),
		},
	});
	mock.module('@/core/infra/observability', { namedExports: { logApiError() {} } });
	mock.module('drizzle-orm', {
		namedExports: {
			and: (...args: unknown[]) => args,
			eq: (...args: unknown[]) => args,
		},
	});
	const guard = await import('../src/core/guards/api-auth.ts');
	const request = (expectedMember: string) =>
		({
			method: 'POST',
			headers: {
				get: (name: string) => (name === 'x-manawg-expected-member-id' ? expectedMember : null),
			},
		}) as never;
	const result: Action = await guard.requireMember(request('member-b'), 'wg-1');
	assert.equal(authenticated, true);
	assert.equal(membershipResolved, true);
	assert.equal(result.ok, false);
	assert.equal(result.reason, 'member_context_changed');
	assert.deepEqual(result.response, { code: 'member_context_changed', status: 409 });
	const matching: Action = await guard.requireMember(request('member-a'), 'wg-1');
	assert.equal(matching.ok, true);
	assert.equal(matching.member.memberId, 'member-a');
});

test('offline data follows the local account and an account switch drops the old queue', async () => {
	const { module, storage } = await makeQueueModule();
	storage.setItem('manawg_account', 'user-a');
	await module.enqueueOfflineAction(createAction({ id: 'new' }));
	assert.equal(module.readOfflineQueue()[0].authUserId, 'user-a');
	const queue = [
		createAction({ id: 'a', authUserId: 'user-a' }),
		createAction({ id: 'legacy' }),
		createAction({ id: 'b', authUserId: 'user-b' }),
	];
	// Entries from before account binding belong to the one account recorded on the device.
	assert.deepEqual(
		module.filterOfflineActionsForAuthUser(queue, 'user-a').map((action) => action.id),
		['a', 'legacy'],
	);
	assert.deepEqual(
		module.filterOfflineActionsForAuthUser(queue, 'user-b').map((action) => action.id),
		['b'],
	);
	assert.equal(module.filterOfflineActionsForAuthUser(queue, null).length, 0);

	await setQueue(module, queue);
	await module.adoptLocalAccount('user-b');
	assert.equal(storage.getItem('manawg_account'), 'user-b');
	assert.deepEqual(
		module.readOfflineQueue().map((action) => action.id),
		['b'],
	);
});

test('an account switch also deletes the dropped actions pending image blobs', async () => {
	const records = new Map<string, Loose>([
		['pic', { id: 'pic', file: new Blob(['abc']), memberId: 'member-a' }],
		['keep', { id: 'keep', file: new Blob(['def']), memberId: 'member-b' }],
	]);
	setGlobal('indexedDB', fakeIndexedDb(records));
	const { module, storage } = await makeQueueModule({ images: null });
	storage.setItem('manawg_account', 'user-a');
	await setQueue(module, [
		createAction({
			id: 'a',
			authUserId: 'user-a',
			payload: { content: 'x', kind: 'info', imageUrl: 'manawg-pending-image:pic' },
		}),
		createAction({
			id: 'b',
			authUserId: 'user-b',
			memberId: 'member-b',
			payload: { content: 'y', kind: 'info', imageUrl: 'manawg-pending-image:keep' },
		}),
	]);
	await module.adoptLocalAccount('user-b');
	assert.deepEqual(
		module.readOfflineQueue().map((action) => action.id),
		['b'],
	);
	assert.equal(records.has('pic'), false);
	assert.equal(records.has('keep'), true);
});

test('a synced queue entry no longer counts as queued for an open queue edit', async () => {
	const { module } = await makeQueueModule({ apiFetch: async () => ({ ok: true, data: {} }) });
	await setQueue(module, [createAction()]);
	assert.equal(module.isOfflineActionQueued('action-1'), true);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(module.isOfflineActionQueued('action-1'), false);
});

test('a stalled image upload times out so the next sync is not blocked', async () => {
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
	setGlobal('indexedDB', fakeIndexedDb(records));
	let sawSignal = false;
	setGlobal('fetch', async (url: string, init: { signal?: AbortSignal }) => {
		if (url === '/api/upload/sign') {
			return Response.json({ presignedUrl: 'https://storage.invalid/upload', publicUrl: 'x' });
		}
		sawSignal = init.signal instanceof AbortSignal;
		// The PUT never resolves on its own; only the timeout signal ends it.
		return new Promise((_resolve, reject) => {
			init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
		});
	});
	const realTimeout = AbortSignal.timeout.bind(AbortSignal);
	const timeoutMock = mock.method(AbortSignal, 'timeout', () => realTimeout(20));
	const { module } = await makeQueueModule({ images: null });
	await setQueue(module, [
		createAction({
			payload: { content: 'x', kind: 'info', imageUrl: 'manawg-pending-image:pic' },
		}),
	]);
	// AbortSignal.timeout uses an unref'd timer in Node; keep the loop alive until it fires.
	const keepAlive = setTimeout(() => {}, 5_000);
	try {
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	} finally {
		clearTimeout(keepAlive);
		timeoutMock.mock.restore();
	}
	assert.equal(sawSignal, true);
	assert.equal(module.readOfflineQueue().length, 1);
});

test('signAndPut reports sign and PUT failures by kind and status', async () => {
	const { signAndPut, PendingImageMissingError: Missing } = await import(
		'../src/core/offline/offline-images.ts'
	);
	const input = {
		shareCode: 'TEST1234',
		purpose: 'expense' as const,
		file: new Blob(['abc'], { type: 'image/png' }),
		contentType: 'image/png',
		memberId: 'member-a',
	};
	const calls: { url: string; init: RequestInit }[] = [];
	const answer = (sign: () => Response, put?: () => Response) =>
		setGlobal('fetch', async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			if (url === '/api/upload/sign') return sign();
			if (put) return put();
			throw new Error('unexpected request');
		});
	const signed = () =>
		Response.json({
			presignedUrl: 'https://storage.invalid/upload',
			publicUrl: 'https://app.invalid/read?key=1',
			uploadHeaders: { 'x-amz-acl': 'private' },
		});

	answer(signed, () => new Response(null, { status: 200 }));
	assert.deepEqual(await signAndPut(input), {
		ok: true,
		publicUrl: 'https://app.invalid/read?key=1',
	});
	const signCall = calls[0] as (typeof calls)[number];
	const putCall = calls[1] as (typeof calls)[number];
	const signHeaders = signCall.init.headers as Record<string, string>;
	assert.equal(signHeaders['x-manawg-expected-member-id'], 'member-a');
	assert.deepEqual(JSON.parse(String(signCall.init.body)), {
		shareCode: 'TEST1234',
		purpose: 'expense',
		mimeType: 'image/png',
		fileSize: 3,
	});
	assert.deepEqual(putCall.init.headers, { 'x-amz-acl': 'private', 'Content-Type': 'image/png' });

	answer(() => Response.json({ error: 'file_too_large' }, { status: 400 }));
	assert.deepEqual(await signAndPut(input), {
		ok: false,
		kind: 'sign',
		status: 400,
		code: 'file_too_large',
	});
	answer(() => new Response('boom', { status: 503 }));
	assert.deepEqual(await signAndPut(input), { ok: false, kind: 'sign', status: 503, code: '' });
	answer(signed, () => new Response(null, { status: 403 }));
	assert.deepEqual(await signAndPut(input), { ok: false, kind: 'put', status: 403 });
	setGlobal('fetch', async () => {
		throw new TypeError('Failed to fetch');
	});
	assert.deepEqual(await signAndPut(input), { ok: false, kind: 'sign', status: 0, code: '' });
	answer(signed, () => {
		throw new TypeError('Failed to fetch');
	});
	assert.deepEqual(await signAndPut(input), { ok: false, kind: 'put', status: 0 });
	assert.equal(new Missing().message, 'pending-image-missing');
});

test('signAndPut does not start requests for a pre-aborted upload', async () => {
	const { signAndPut } = await import('../src/core/offline/offline-images.ts');
	const controller = new AbortController();
	controller.abort();
	let requests = 0;
	setGlobal('fetch', async () => {
		requests += 1;
		return Response.json({
			presignedUrl: 'https://storage.invalid/upload',
			publicUrl: 'https://app.invalid/read?key=1',
		});
	});

	assert.deepEqual(
		await signAndPut({
			shareCode: 'TEST1234',
			purpose: 'expense',
			file: new Blob(['abc'], { type: 'image/png' }),
			contentType: 'image/png',
			signal: controller.signal,
		}),
		{ ok: false, kind: 'sign', status: 0, code: '' },
	);
	assert.equal(requests, 0);
});

test('storage account change aborts an active sign request', async () => {
	const storage = makeStorage();
	storage.setItem('manawg_account', 'account-a');
	const windowTarget = Object.assign(new EventTarget(), { localStorage: storage });
	setGlobal('window', windowTarget);
	const response = deferred<Response>();
	const started = deferred<void>();
	let requestSignal: AbortSignal | undefined;
	let putRequests = 0;
	setGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (url === '/api/upload/sign') {
			requestSignal = init?.signal ?? undefined;
			started.resolve();
			return response.promise;
		}
		putRequests += 1;
		return new Response(null, { status: 200 });
	});
	const { signAndPut } = await import('../src/core/offline/offline-images.ts');
	const pending = signAndPut({
		shareCode: 'TEST1234',
		purpose: 'expense',
		file: new Blob(['abc'], { type: 'image/png' }),
		contentType: 'image/png',
	});
	await started.promise;
	storage.setItem('manawg_account', 'account-b');
	windowTarget.dispatchEvent(new Event('storage'));
	assert.equal(requestSignal?.aborted, true);
	response.resolve(
		Response.json({
			presignedUrl: 'https://storage.invalid/upload',
			publicUrl: 'https://app.invalid/read?key=account-a',
		}),
	);

	assert.deepEqual(await pending, { ok: false, kind: 'sign', status: 0, code: '' });
	assert.equal(putRequests, 0);
});

for (const phase of ['sign response', 'sign body', 'PUT response'] as const) {
	test(`account switch during ${phase} stops obsolete upload work`, async () => {
		const storage = makeStorage();
		storage.setItem('manawg_account', 'account-a');
		setGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
		const gate = deferred<Response>();
		const bodyGate = deferred<object>();
		const started = deferred();
		const signed = {
			presignedUrl: 'https://storage.invalid/upload',
			publicUrl: 'https://app.invalid/read?key=owned-by-a',
		};
		let puts = 0;
		setGlobal('fetch', async (url: string) => {
			if (url === '/api/upload/sign') {
				if (phase === 'sign response') {
					started.resolve();
					return gate.promise;
				}
				const response = Response.json(signed);
				if (phase === 'sign body') {
					mock.method(response, 'json', async () => {
						started.resolve();
						return bodyGate.promise;
					});
				}
				return response;
			}
			puts += 1;
			started.resolve();
			return gate.promise;
		});
		const { signAndPut } = await import('../src/core/offline/offline-images.ts');
		const pending = signAndPut({
			shareCode: 'TEST1234',
			purpose: 'expense',
			file: new Blob(['private image A'], { type: 'image/png' }),
			contentType: 'image/png',
			memberId: 'member-a',
		});
		await started.promise;
		storage.setItem('manawg_account', 'account-b');
		gate.resolve(phase === 'sign response' ? Response.json(signed) : new Response(null));
		bodyGate.resolve(signed);
		const result = await pending;
		assert.equal(result.ok, false, 'a completed old upload cannot become a result for B');
		assert.equal(puts, phase === 'PUT response' ? 1 : 0, 'no obsolete PUT may start');
	});
}

test('pending upload preserves a concurrent public URL instead of overwriting it', async () => {
	const storage = makeStorage();
	storage.setItem('manawg_account', 'account-a');
	setGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
	const record = (id: string) => ({
		id,
		file: new Blob([id]),
		name: `${id}.png`,
		type: 'image/png',
		size: id.length,
		shareCode: 'TEST1234',
		memberId: 'member-a',
		purpose: 'expense',
		createdAt: new Date().toISOString(),
	});
	const first = record('first');
	const concurrent = record('concurrent');
	const records = new Map<string, Loose>([
		[first.id, first],
		[concurrent.id, concurrent],
	]);
	setGlobal('indexedDB', fakeIndexedDb(records));
	const putGate = deferred<Response>();
	const putStarted = deferred<void>();
	let holdPut = false;
	setGlobal('fetch', async (url: string) => {
		if (url === '/api/upload/sign')
			return Response.json({
				presignedUrl: 'https://storage.invalid/upload',
				publicUrl: 'https://app.invalid/read?key=upload-response',
			});
		if (holdPut) {
			putStarted.resolve();
			return putGate.promise;
		}
		return new Response(null, { status: 200 });
	});
	const { uploadPendingImageToken } = await import('../src/core/offline/offline-images.ts');
	assert.equal(
		await uploadPendingImageToken('manawg-pending-image:first', 'member-a'),
		'https://app.invalid/read?key=upload-response',
	);
	assert.equal(
		(records.get(first.id) as { publicUrl?: string }).publicUrl,
		'https://app.invalid/read?key=upload-response',
	);

	holdPut = true;
	const pending = uploadPendingImageToken('manawg-pending-image:concurrent', 'member-a');
	await putStarted.promise;
	const latestUrl = 'https://app.invalid/read?key=already-saved';
	records.set(concurrent.id, { ...concurrent, publicUrl: latestUrl });
	putGate.resolve(new Response(null, { status: 200 }));

	assert.equal(await pending, latestUrl);
	assert.equal((records.get(concurrent.id) as { publicUrl?: string }).publicUrl, latestUrl);
});

test('an image removed while its upload is pending is never recreated by writeback', async () => {
	const records = new Map<string, Loose>([
		[
			'pic',
			{
				id: 'pic',
				file: new Blob(['image A']),
				name: 'a.png',
				type: 'image/png',
				size: 7,
				shareCode: 'TEST1234',
				memberId: 'member-a',
				purpose: 'expense',
				createdAt: new Date().toISOString(),
			},
		],
	]);
	setGlobal('indexedDB', fakeIndexedDb(records));
	const started = deferred();
	const response = deferred<Response>();
	setGlobal('fetch', async (url: string) => {
		if (url === '/api/upload/sign')
			return Response.json({
				presignedUrl: 'https://storage.invalid/upload',
				publicUrl: 'https://app.invalid/read?key=A',
			});
		started.resolve();
		return response.promise;
	});
	const { uploadPendingImageToken, removePendingImage } = await import(
		'../src/core/offline/offline-images.ts'
	);
	const pending = uploadPendingImageToken('manawg-pending-image:pic', 'member-a');
	await started.promise;
	await removePendingImage('manawg-pending-image:pic', 'member-a');
	assert.equal(records.has('pic'), false);
	response.resolve(new Response(null));
	await assert.rejects(pending, PendingImageMissingError);
	assert.equal(records.has('pic'), false, 'the removed private blob must stay removed');
});
