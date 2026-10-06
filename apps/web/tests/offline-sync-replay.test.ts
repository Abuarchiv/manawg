import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { OfflineAction } from '@/core/offline/offline-action';
import {
	OFFLINE_REPLAY_MAX_AGE_MS,
	RESPONSE_REPLAY_TTL_SECONDS,
} from '@/core/offline/replay-retention';
import {
	type ApiInit,
	type ApiResult,
	VALID_KEY,
	createAction,
	deferred,
	makeLockManager,
	makeQueueModule,
	makeStorage,
	queued,
	restoreGlobals,
	setQueue,
	storedQueue,
} from './support/offline-queue-harness';

afterEach(restoreGlobals);

test('expired replay windows fence automatic and forced sync before upload or mutation', async () => {
	const now = Date.parse('2026-10-10T12:00:00Z');
	class Clock extends Date {
		static override now() {
			return now;
		}
	}
	for (const force of [false, true]) {
		for (const attempts of [undefined, 3]) {
			let requests = 0;
			let uploads = 0;
			const storage = makeStorage();
			const { module } = await makeQueueModule({
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
			const retained = queued(module);
			assert.equal(retained.idempotencyKey, action.idempotencyKey);
			assert.equal(JSON.stringify(retained.payload), JSON.stringify(action.payload));
			assert.match(String(retained.lastError), /^Server prüfen:/);
			assert.match(String(retained.lastError), /Wiederholungsfrist ist abgelaufen/);
			assert.equal(module.needsManualOfflineResolution(retained), true);
		}
	}
});

test('replay fence includes the retention boundary and invalid clocks but tolerates small future skew', async () => {
	const now = Date.parse('2026-10-10T12:00:00Z');
	class Clock extends Date {
		static override now() {
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
	] as const) {
		let requests = 0;
		const { module } = await makeQueueModule({
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
		static override now() {
			return now;
		}
	}
	let requests = 0;
	const { module } = await makeQueueModule({
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
	assert.match(String(queued(module).lastError), /^Server prüfen:/);
});

test('sync does not resurrect an action deleted while its request waits', async () => {
	const entered = deferred();
	const response = deferred<ApiResult>();
	const { module } = await makeQueueModule({
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
	const response = deferred<ApiResult>();
	let requestCount = 0;
	const { module } = await makeQueueModule({
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
	assert.equal(queued(module).payload.content, 'edited');
	assert.match(String(queued(module).lastError), /^Server prüfen:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 1);
});

test('a successful old request cannot hide a concurrent edit when final storage save fails', async () => {
	const entered = deferred();
	const response = deferred<ApiResult>();
	const storage = makeStorage();
	let failQueueSave = false;
	storage.setItem = (key: string, value: string) => {
		if (failQueueSave && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	const { module } = await makeQueueModule({
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
	const edited = queued(module);
	assert.equal(edited.payload.content, 'edited');
	assert.equal(edited.idempotencyKey, VALID_KEY);
	assert.match(String(edited.lastError), /^Server prüfen:/);
	const reloaded = await makeQueueModule({
		storage,
		apiFetch: async () => {
			throw new Error('review-required action must not replay');
		},
	});
	assert.match(String(queued(reloaded.module).lastError), /^Server prüfen:/);
	await reloaded.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	failQueueSave = false;
	await setQueue(reloaded.module, []);
	assert.equal(storage.getItem('manawg:offline-review-ids'), '{}');
	await setQueue(reloaded.module, [
		createAction({ payload: { content: 'replacement', kind: 'info', imageUrl: null } }),
	]);
	assert.equal(queued(reloaded.module).lastError, undefined);
});

test('failed final queue read marks a successful action for review after storage recovers', async () => {
	const storage = makeStorage();
	const locks = makeLockManager();
	const getItem = storage.getItem.bind(storage);
	let failQueueRead = false;
	let requests = 0;
	storage.getItem = (key: string) => {
		if (failQueueRead && key === 'manawg:offline-actions')
			throw new Error('temporary read failure');
		return getItem(key);
	};
	const { module } = await makeQueueModule({
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
	const recovered = queued(module);
	assert.equal(recovered.payload.content, 'original');
	assert.match(String(recovered.lastError), /^Server prüfen:/);
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
	assert.equal(queued(module).payload.content, 'edited');
	assert.match(String(queued(module).lastError), /^Server prüfen:/);
	assert.equal(
		await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' }),
		0,
	);
	assert.equal(requests, 1);
});

test('failed final save keeps an expense when its recurring follow-up was not persisted', async () => {
	const storage = makeStorage();
	let primaryRequestDone = false;
	storage.setItem = (key: string, value: string) => {
		if (primaryRequestDone && key === 'manawg:offline-actions') throw new Error('quota');
		storage.values.set(key, String(value));
	};
	let calls = 0;
	const { module } = await makeQueueModule({
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
	assert.equal(queued(module).type, 'expense.create');
});

test('a recurring advance action is not followed by a second advance request', async () => {
	let calls = 0;
	const { module } = await makeQueueModule({
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
	let request: ApiInit | undefined;
	const { module } = await makeQueueModule({
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
	assert.equal(request?.headers?.['Idempotency-Key'], VALID_KEY);
	assert.equal(request?.memberId, 'member-a');
});

test('resolved upload URL is persisted to the queue before its IndexedDB blob is deleted', async () => {
	const pendingToken = 'manawg-pending-image:pic';
	const publicUrl = 'https://app.invalid/api/upload/read?key=uploaded';
	const records = new Map<string, unknown>([
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
			const request: { result: unknown; onsuccess?: () => void } = {
				result: null,
			};
			request.result = {
				objectStoreNames: { contains: () => true },
				createObjectStore() {},
				close() {},
				transaction() {
					const tx: {
						oncomplete?: () => void;
						onerror?: () => void;
						error: unknown;
						objectStore?: () => unknown;
					} = { error: null };
					const makeRequest = (run: () => unknown) => {
						const req: {
							result: unknown;
							error: unknown;
							onsuccess?: () => void;
							onerror?: () => void;
						} = { result: undefined, error: null };
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
						get: (key: string) => makeRequest(() => records.get(key)),
						put: (value: unknown, key: string) =>
							makeRequest(() => {
								records.set(key, value);
								return key;
							}),
						delete: (key: string) => makeRequest(() => records.delete(key)),
					});
					return tx;
				},
			};
			queueMicrotask(() => request.onsuccess?.());
			return request;
		},
	};
	const storage = makeStorage();
	let queueAtRequest: OfflineAction[] = [];
	const { module } = await await makeQueueModule({
		storage,
		images: 'real',
		globals: {
			indexedDB,
			fetch: async (url: string) =>
				url === '/api/upload/sign'
					? Response.json({
							presignedUrl: 'https://storage.invalid/upload',
							publicUrl,
							maxFileSize: 100,
						})
					: new Response(null, { status: 200 }),
		},
		apiFetch: async () => {
			queueAtRequest = storedQueue(storage);
			return { ok: false, status: 0, error: 'network' };
		},
	});
	await setQueue(module, [
		createAction({ payload: { content: 'with image', kind: 'info', imageUrl: pendingToken } }),
	]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(queueAtRequest[0]?.payload.imageUrl, publicUrl);
	assert.equal(queued(module).payload.imageUrl, publicUrl);
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
			const current = queued(module);
			await setQueue(module, [{ ...current, payload: { ...current.payload, content: 'edited' } }]);
		}
		cleanupRelease.resolve();
		await syncing;
		assert.equal(requestCount, 0);
	}
});

test('edit during image upload keeps the replacement and does not send the stale snapshot', async () => {
	const uploadStarted = deferred();
	const uploadResponse = deferred<string>();
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
	assert.equal(queued(module).payload.content, 'edited');
	assert.equal(queued(module).payload.imageUrl, 'manawg-pending-image:pic');
});

test('aborting after an auth change stops later requests and keeps all queue entries', async () => {
	const entered = deferred();
	let requestCount = 0;
	const { module } = await makeQueueModule({
		apiFetch: async (_path, init) => {
			requestCount += 1;
			entered.resolve();
			return new Promise((resolve) => {
				init.signal?.addEventListener(
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
				throw new Error('pending-image-missing');
			},
		},
	});
	await setQueue(module, [pendingAction]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(queued(module).payload.imageUrl, 'manawg-pending-image:missing');
	assert.match(String(queued(module).lastError), /^Bild fehlt:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 0);
	await setQueue(module, [
		{
			...queued(module),
			payload: { ...queued(module).payload, imageUrl: null },
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
	assert.match(String(queued(revoked.module).lastError), /^Bild wurde entfernt:/);
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
	const blocked = queued(module);
	assert.equal(blocked.payload.imageUrl, publicUrl);
	assert.match(String(blocked.lastError), /^Bild wurde entfernt:/);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 1);
	await setQueue(module, [{ ...blocked, payload: { ...blocked.payload, imageUrl: null } }]);
	await module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(requestCount, 2);
	assert.equal(module.readOfflineQueue().length, 0);

	const entered = deferred();
	const response = deferred<ApiResult>();
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
	const current = queued(raced.module);
	await setQueue(raced.module, [{ ...current, payload: { ...current.payload, imageUrl: null } }]);
	response.resolve({ ok: false, status: 409, error: 'image_removed' });
	await syncing;
	assert.equal(queued(raced.module).payload.imageUrl, null);
	assert.doesNotMatch(queued(raced.module).lastError ?? '', /^Server prüfen:/);
	await raced.module.syncOfflineActions('TEST1234', { force: true, memberId: 'member-a' });
	assert.equal(racedRequestCount, 2);
	assert.equal(raced.module.readOfflineQueue().length, 0);
});
