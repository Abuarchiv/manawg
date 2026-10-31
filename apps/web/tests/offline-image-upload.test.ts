import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import {
	createAction,
	deferred,
	fakeIndexedDb,
	makeQueueModule,
	makeStorage,
	PendingImageMissingError,
	restoreGlobals,
	setGlobal,
	setQueue,
} from './support/offline-harness.ts';

// biome-ignore lint/suspicious/noExplicitAny: hand-rolled IndexedDB fake
type Loose = any;

afterEach(restoreGlobals);

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
