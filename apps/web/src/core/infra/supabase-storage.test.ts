import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const state = {
	bucket: null as unknown,
	keys: null as string[] | null,
	fetchSignal: null as AbortSignal | null,
	fetchOptions: null as RequestInit | null,
};

mock.module('server-only', { namedExports: {} });
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

const { ImageStorageConfigurationError, removeSupabaseImages } = await import('./supabase-storage');

function harness() {
	state.bucket = null;
	state.keys = null;
	state.fetchSignal = null;
	state.fetchOptions = null;
	return { state, ImageStorageConfigurationError, removeSupabaseImages };
}

test('cleanup removes through Supabase with a bounded request even when uploads use AWS', async () => {
	const previous = {
		fetch: globalThis.fetch,
		url: process.env.NEXT_PUBLIC_SUPABASE_URL,
		serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
		bucketName: process.env.SUPABASE_STORAGE_BUCKET,
		provider: process.env.IMAGE_STORAGE_PROVIDER,
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
	process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example';
	process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
	process.env.SUPABASE_STORAGE_BUCKET = 'private-images';
	process.env.IMAGE_STORAGE_PROVIDER = 'aws';
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
		const restore: Array<[string, string | undefined]> = [
			['NEXT_PUBLIC_SUPABASE_URL', previous.url],
			['SUPABASE_SERVICE_ROLE_KEY', previous.serviceRole],
			['SUPABASE_STORAGE_BUCKET', previous.bucketName],
			['IMAGE_STORAGE_PROVIDER', previous.provider],
		];
		for (const [name, value] of restore) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	}
});

test('cleanup fails closed when bucket policy no longer matches the private image contract', async () => {
	const previous = {
		url: process.env.NEXT_PUBLIC_SUPABASE_URL,
		serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
		bucketName: process.env.SUPABASE_STORAGE_BUCKET,
	};
	const { state, ImageStorageConfigurationError, removeSupabaseImages } = harness();
	state.bucket = { public: true, file_size_limit: 8 * 1024 * 1024, allowed_mime_types: [] };
	process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example';
	process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
	process.env.SUPABASE_STORAGE_BUCKET = 'private-images';
	try {
		await assert.rejects(
			removeSupabaseImages([
				'manawg/11111111-1111-4111-8111-111111111111/expense/22222222-2222-4222-8222-222222222222.jpg',
			]),
			ImageStorageConfigurationError,
		);
		assert.equal(state.keys, null);
	} finally {
		const restore: Array<[string, string | undefined]> = [
			['NEXT_PUBLIC_SUPABASE_URL', previous.url],
			['SUPABASE_SERVICE_ROLE_KEY', previous.serviceRole],
			['SUPABASE_STORAGE_BUCKET', previous.bucketName],
		];
		for (const [name, value] of restore) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	}
});
