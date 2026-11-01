import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { applyEnv } from '../../../tests/support/env';

const state = {
	bucket: null as unknown,
	keys: null as string[] | null,
	fetchSignal: null as AbortSignal | null,
	fetchOptions: null as RequestInit | null,
	info: null as unknown,
	chunks: [] as Uint8Array[],
	downloadCalls: 0,
	sourceCancelled: false,
};

mock.module('@supabase/supabase-js', {
	namedExports: {
		createClient: (
			_url: string,
			_serviceRoleKey: string,
			options: { global: { fetch: typeof fetch } },
		) => ({
			storage: {
				getBucket: async (_bucket: string) => ({ data: state.bucket, error: null }),
				from: (_bucket: string) => ({
					info: async (_key: string) => ({ data: state.info, error: null }),
					download: (_key: string) => ({
						asStream: async () => {
							state.downloadCalls += 1;
							const chunks = [...state.chunks];
							return {
								data: new ReadableStream<Uint8Array>({
									pull(controller) {
										const next = chunks.shift();
										if (next) controller.enqueue(next);
										else controller.close();
									},
									cancel() {
										state.sourceCancelled = true;
									},
								}),
								error: null,
							};
						},
					}),
					remove: async (keys: string[]) => {
						state.keys = keys;
						const response = await options.global.fetch('https://storage.example/remove', {
							method: 'DELETE',
						});
						return { data: [], error: response.ok ? null : new Error('remove failed') };
					},
				}),
			},
		}),
	},
});

const {
	ImageStorageConfigurationError,
	ImageStorageObjectNotFoundError,
	downloadSupabaseImage,
	removeSupabaseImages,
} = await import('./supabase-storage');

function harness() {
	state.bucket = null;
	state.keys = null;
	state.fetchSignal = null;
	state.fetchOptions = null;
	state.info = null;
	state.chunks = [];
	state.downloadCalls = 0;
	state.sourceCancelled = false;
	return { state, ImageStorageConfigurationError, removeSupabaseImages };
}

test('cleanup removes through Supabase with a bounded request', async () => {
	const previous = {
		fetch: globalThis.fetch,
	};
	const { state, removeSupabaseImages } = harness();
	state.bucket = {
		public: false,
		file_size_limit: 8 * 1024 * 1024,
		allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
	};
	globalThis.fetch = async (_input: unknown, options?: RequestInit) => {
		state.fetchSignal = options?.signal ?? null;
		state.fetchOptions = options ?? null;
		return new Response(null, { status: 204 });
	};
	const restoreEnv = applyEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
	});
	try {
		const keys = [
			'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
			'manawg/11111111-1111-4111-8111-111111111111/announcement/33333333-3333-4333-8333-333333333333.png',
		];
		await removeSupabaseImages(keys);
		assert.deepEqual(state.keys, keys);
		assert.ok(state.fetchSignal instanceof AbortSignal);
		assert.equal((state.fetchSignal as AbortSignal).aborted, false);
		assert.equal(state.fetchOptions?.method, 'DELETE');
	} finally {
		globalThis.fetch = previous.fetch;
		restoreEnv();
	}
});

test('cleanup fails closed when bucket policy no longer matches the private image contract', async () => {
	const { state, ImageStorageConfigurationError, removeSupabaseImages } = harness();
	state.bucket = { public: true, file_size_limit: 8 * 1024 * 1024, allowed_mime_types: [] };
	const restoreEnv = applyEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
	});
	try {
		await assert.rejects(
			removeSupabaseImages([
				'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
			]),
			ImageStorageConfigurationError,
		);
		assert.equal(state.keys, null);
	} finally {
		restoreEnv();
	}
});

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_KEY =
	'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.png';

function applyImageEnv() {
	return applyEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
	});
}

function privateBucket() {
	return {
		public: false,
		file_size_limit: MAX_BYTES,
		allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
	};
}

async function readAll(stream: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return Buffer.concat(chunks);
		chunks.push(value);
	}
}

test('download rejects object metadata outside the MIME and size policy before opening the stream', async () => {
	const { state } = harness();
	state.bucket = privateBucket();
	const restoreEnv = applyImageEnv();
	try {
		for (const info of [
			{ contentType: 'text/html', size: 10 },
			{ contentType: 'image/svg+xml', size: 10 },
			{ contentType: 'image/png', size: 0 },
			{ contentType: 'image/png', size: MAX_BYTES + 1 },
		]) {
			state.info = info;
			await assert.rejects(downloadSupabaseImage(IMAGE_KEY), ImageStorageObjectNotFoundError);
			assert.equal(state.downloadCalls, 0);
		}
	} finally {
		restoreEnv();
	}
});

test('download returns the stream with its content type and length for an allowed image', async () => {
	const { state } = harness();
	state.bucket = privateBucket();
	state.info = { contentType: 'image/png', size: 3 };
	state.chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
	const restoreEnv = applyImageEnv();
	try {
		const download = await downloadSupabaseImage(IMAGE_KEY);
		assert.equal(download.contentType, 'image/png');
		assert.equal(download.contentLength, 3);
		assert.deepEqual([...(await readAll(download.stream))], [1, 2, 3]);
		assert.equal(state.downloadCalls, 1);
	} finally {
		restoreEnv();
	}
});

test('download stream errors and cancels the source once it exceeds the size cap', async () => {
	const { state } = harness();
	state.bucket = privateBucket();
	state.info = { contentType: 'image/png', size: 10 };
	state.chunks = [new Uint8Array(MAX_BYTES), new Uint8Array(1), new Uint8Array(1)];
	const restoreEnv = applyImageEnv();
	try {
		const download = await downloadSupabaseImage(IMAGE_KEY);
		await assert.rejects(readAll(download.stream), ImageStorageObjectNotFoundError);
		assert.equal(state.sourceCancelled, true);
	} finally {
		restoreEnv();
	}
});
