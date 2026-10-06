import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

type ClientOptions = { global?: { fetch: typeof fetch } };

const state = {
	bucket: null as Record<string, unknown> | null,
	keys: null as string[] | null,
	fetchOptions: null as RequestInit | null,
	bucketName: null as string | null,
	signedUploads: [] as { key: string; options: unknown }[],
};

mock.module('@supabase/supabase-js', {
	namedExports: {
		createClient: (_url: string, _serviceRoleKey: string, options: ClientOptions) => ({
			storage: {
				getBucket: async (name: string) => {
					state.bucketName = name;
					return { data: state.bucket, error: null };
				},
				from: () => ({
					createSignedUploadUrl: async (key: string, uploadOptions: unknown) => {
						state.signedUploads.push({ key, options: uploadOptions });
						return { data: { signedUrl: `https://storage.example/upload/${key}` }, error: null };
					},
					remove: async (keys: string[]) => {
						state.keys = keys;
						const bounded = options.global?.fetch;
						if (!bounded) throw new Error('cleanup must use a bounded fetch');
						const response = await bounded('https://storage.example/remove', {
							method: 'DELETE',
						});
						return { data: [], error: response.ok ? null : new Error('remove failed') };
					},
				}),
			},
		}),
	},
});

const { ImageStorageConfigurationError, createSupabaseSignedUpload, removeSupabaseImages } =
	await import('./supabase-storage');

const ENV_NAMES = [
	'NEXT_PUBLIC_SUPABASE_URL',
	'SUPABASE_SERVICE_ROLE_KEY',
	'SUPABASE_STORAGE_BUCKET',
	'IMAGE_STORAGE_PROVIDER',
] as const;

function withEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string>>): () => void {
	const previous = ENV_NAMES.map((name) => [name, process.env[name]] as const);
	for (const [name, value] of Object.entries(values)) process.env[name] = value;
	return () => {
		for (const [name, value] of previous) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	};
}

function reset(): void {
	state.bucket = null;
	state.keys = null;
	state.fetchOptions = null;
	state.bucketName = null;
	state.signedUploads = [];
}

const PRIVATE_BUCKET = {
	public: false,
	file_size_limit: 8 * 1024 * 1024,
	allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
};
const UPLOAD_KEY =
	'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg';

test('cleanup removes through Supabase with a bounded request even when uploads use AWS', async () => {
	reset();
	const previousFetch = globalThis.fetch;
	state.bucket = {
		public: false,
		file_size_limit: 8 * 1024 * 1024,
		allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
	};
	globalThis.fetch = async (_input, options) => {
		state.fetchOptions = options ?? null;
		return new Response(null, { status: 204 });
	};
	const restoreEnv = withEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
		IMAGE_STORAGE_PROVIDER: 'aws',
	});
	try {
		const keys = [
			'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
			'manawg/11111111-1111-4111-8111-111111111111/announcement/33333333-3333-4333-8333-333333333333.png',
		];
		await removeSupabaseImages(keys);
		assert.deepEqual(state.keys, keys);
		const signal = state.fetchOptions?.signal;
		assert.ok(signal instanceof AbortSignal);
		assert.equal(signal.aborted, false);
		assert.equal(state.fetchOptions?.method, 'DELETE');
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv();
	}
});

test('cleanup fails closed when bucket policy no longer matches the private image contract', async () => {
	reset();
	state.bucket = { public: true, file_size_limit: 8 * 1024 * 1024, allowed_mime_types: [] };
	const restoreEnv = withEnv({
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

test('signed uploads never overwrite an object and carry the upload contract', async () => {
	reset();
	state.bucket = PRIVATE_BUCKET;
	const restoreEnv = withEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
	});
	try {
		const signed = await createSupabaseSignedUpload(UPLOAD_KEY, 'image/jpeg');
		assert.equal(state.bucketName, 'private-images');
		assert.deepEqual(state.signedUploads, [{ key: UPLOAD_KEY, options: { upsert: false } }]);
		assert.deepEqual(signed, {
			presignedUrl: `https://storage.example/upload/${UPLOAD_KEY}`,
			maxFileSize: 8 * 1024 * 1024,
			uploadHeaders: { 'Cache-Control': 'max-age=0' },
		});
	} finally {
		restoreEnv();
	}
});

test('upload signing fails closed for a non-private bucket or a disallowed MIME type', async () => {
	const restoreEnv = withEnv({
		NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.example',
		SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
		SUPABASE_STORAGE_BUCKET: 'private-images',
	});
	try {
		reset();
		state.bucket = { ...PRIVATE_BUCKET, public: true };
		await assert.rejects(
			createSupabaseSignedUpload(UPLOAD_KEY, 'image/jpeg'),
			ImageStorageConfigurationError,
		);
		reset();
		state.bucket = PRIVATE_BUCKET;
		await assert.rejects(
			createSupabaseSignedUpload(UPLOAD_KEY, 'image/gif'),
			ImageStorageConfigurationError,
		);
		assert.deepEqual(state.signedUploads, []);
	} finally {
		restoreEnv();
	}
});
