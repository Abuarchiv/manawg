import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { NextRequest } from 'next/server';
import { checkEnv } from '../src/core/infra/env';
import * as privateImagePolicy from '../src/core/infra/private-image-policy';
import { assertMatchObject } from './support/match-object';

// S3 configuration is read when the module loads, so every pinned environment gets its own copy of
// the real s3 module; the sign route sees whichever copy the test installed.

type S3Module = typeof import('../src/core/infra/s3');
type S3Stand = Pick<
	S3Module,
	'S3ConfigurationError' | 'S3_MAX_UPLOAD_BYTES' | 'createPresignedUpload' | 'isAllowedMimeType'
>;
type LimitResult = { success: boolean; limiterUnavailable?: boolean; reset?: number };

const KEY =
	'manawg/989ac820-58b7-431f-9c65-28721264f333/expense/550e8400-e29b-41d4-a716-446655440000.png';
const BODY = {
	shareCode: 'ABC12345',
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: 1024,
};
const S3_ENV_KEYS = [
	'AWS_REGION',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'S3_BUCKET',
	'S3_PUBLIC_URL',
] as const;

const current = {
	s3: null as S3Stand | null,
	limit: { success: true } as LimitResult,
};

function installedS3(): S3Stand {
	if (!current.s3) throw new Error('no s3 module installed for this request');
	return current.s3;
}

mock.module('@/core/auth/server', {
	namedExports: { getAuthenticatedUser: async () => ({ id: 'user-1' }) },
});
mock.module('@/core/db', {
	namedExports: { db: { query: { wgs: { findFirst: async () => ({ id: 'wg-1' }) } } } },
});
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		requireMember: async () => ({ ok: true, member: { memberId: 'member-1', name: 'Member' } }),
	},
});
mock.module('@/core/infra/s3', {
	namedExports: {
		// The route tells configuration failures apart with instanceof; errors come from the installed copy.
		S3ConfigurationError: class {
			static [Symbol.hasInstance](value: unknown) {
				return value instanceof installedS3().S3ConfigurationError;
			}
		},
		S3_MAX_UPLOAD_BYTES: privateImagePolicy.PRIVATE_IMAGE_MAX_BYTES,
		createPresignedUpload: (...args: Parameters<S3Module['createPresignedUpload']>) =>
			installedS3().createPresignedUpload(...args),
		isAllowedMimeType: (mimeType: string) => installedS3().isAllowedMimeType(mimeType),
	},
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError: class extends Error {},
		getImageStorageProvider: () => 'aws',
		createSupabaseSignedUpload: async () => {
			throw new Error('supabase signing is not part of this contract');
		},
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => current.limit, uploadSignLimiter: {} },
});
mock.module('@/core/validators/image-url', {
	namedExports: { getPrivateImageUrl: (key: string) => `https://images.example/${key}` },
});

const route = await import('../src/app/api/upload/sign/route');

function pinS3Env(values: Partial<Record<(typeof S3_ENV_KEYS)[number], string>>): () => void {
	const saved = S3_ENV_KEYS.map((key) => [key, process.env[key]] as const);
	for (const key of S3_ENV_KEYS) delete process.env[key];
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) process.env[key] = value;
	}
	return () => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}

let loads = 0;

async function loadS3(): Promise<S3Module> {
	loads += 1;
	return import(new URL(`../src/core/infra/s3.ts?load=${loads}`, import.meta.url).href);
}

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('expected the call to reject');
}

async function post(s3: S3Stand, limit: LimitResult = { success: true }): Promise<Response> {
	current.s3 = s3;
	current.limit = limit;
	return route.POST(
		new NextRequest('https://example.invalid/api/upload/sign', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(BODY),
		}),
	);
}

describe('upload sign s3 config contract', () => {
	test('missing S3 configuration throws a typed S3ConfigurationError', async () => {
		const restoreEmpty = pinS3Env({});
		try {
			const s3 = await loadS3();
			const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
			assert.ok(error instanceof s3.S3ConfigurationError);
		} finally {
			restoreEmpty();
		}

		const restoreNoKeys = pinS3Env({ S3_BUCKET: 'manawg-bucket', AWS_REGION: 'us-east-1' });
		try {
			const s3 = await loadS3();
			const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
			assert.ok(error instanceof s3.S3ConfigurationError);
		} finally {
			restoreNoKeys();
		}
	});

	test('invalid S3 public URLs are reported at boot and fail as typed degraded uploads', async () => {
		for (const publicUrl of [
			'http://cdn.example.com',
			'https://user:password@cdn.example.com',
			'https://cdn.example.com/?token=secret-test-sentinel',
		]) {
			const config = {
				AWS_REGION: 'us-east-1',
				AWS_ACCESS_KEY_ID: 'test-access-key',
				AWS_SECRET_ACCESS_KEY: 'test-secret-key',
				S3_BUCKET: 'manawg-bucket',
				S3_PUBLIC_URL: publicUrl,
			};
			assert.ok(
				checkEnv({ ...config, VERCEL_ENV: 'production' }).missingRequired.includes('S3_PUBLIC_URL'),
			);
			const restore = pinS3Env(config);
			try {
				const s3 = await loadS3();
				const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
				assert.ok(error instanceof s3.S3ConfigurationError);
				const response = await post(s3);
				assert.equal(response.status, 503);
				assert.deepEqual(await response.json(), {
					error: 'feature_disabled',
					code: 'image_uploads_unavailable',
				});
			} finally {
				restore();
			}
		}
	});

	test('upload signing reports an unavailable limiter as 503 with a retry hint', async () => {
		const restore = pinS3Env({});
		try {
			const response = await post(await loadS3(), {
				success: false,
				limiterUnavailable: true,
				reset: Date.now() + 60_000,
			});
			assert.equal(response.status, 503);
			assertMatchObject(await response.json(), { error: 'rate_limiter_unavailable' });
			assert.notEqual(response.headers.get('retry-after'), null);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restore();
		}
	});

	test('the sign route answers 503 feature_disabled for S3 configuration failures', async () => {
		const restoreNoBucket = pinS3Env({});
		try {
			const response = await post(await loadS3());
			assert.equal(response.status, 503);
			assert.deepEqual(await response.json(), {
				error: 'feature_disabled',
				code: 'image_uploads_unavailable',
			});
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restoreNoBucket();
		}

		const restoreNoKeys = pinS3Env({ S3_BUCKET: 'manawg-bucket', AWS_REGION: 'us-east-1' });
		try {
			const response = await post(await loadS3());
			assert.equal(response.status, 503);
			assert.deepEqual(await response.json(), {
				error: 'feature_disabled',
				code: 'image_uploads_unavailable',
			});
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restoreNoKeys();
		}
	});

	test('the sign route keeps unrelated S3 failures as a 500 sign_failed', async () => {
		const legacyMessageError: S3Stand = {
			S3ConfigurationError: class extends Error {} as S3Stand['S3ConfigurationError'],
			S3_MAX_UPLOAD_BYTES: privateImagePolicy.PRIVATE_IMAGE_MAX_BYTES,
			isAllowedMimeType: () => true,
			createPresignedUpload: async () => {
				throw new Error(
					'S3 credentials missing. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.',
				);
			},
		};
		const response = await post(legacyMessageError);

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { error: 'sign_failed' });
	});

	test('the sign route returns a presigned upload when S3 is configured', async () => {
		const restore = pinS3Env({
			S3_BUCKET: 'manawg-bucket',
			AWS_REGION: 'us-east-1',
			S3_PUBLIC_URL: 'https://cdn.example.com/',
			AWS_ACCESS_KEY_ID: 'test-access-key',
			AWS_SECRET_ACCESS_KEY: 'test-secret-key',
		});
		try {
			const response = await post(await loadS3());
			assert.equal(response.status, 200);
			const body = (await response.json()) as {
				presignedUrl: string;
				publicUrl: string;
				maxFileSize: number;
			};
			assert.ok(body.presignedUrl.includes('X-Amz-Signature'));
			assert.equal(body.maxFileSize, 8 * 1024 * 1024);
			assert.match(
				body.publicUrl,
				/^https:\/\/cdn\.example\.com\/manawg\/wg-1\/expense\/[0-9a-f-]{36}\.png$/,
			);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restore();
		}
	});
});
