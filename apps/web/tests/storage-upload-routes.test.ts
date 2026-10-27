import assert from 'node:assert/strict';
import path from 'node:path';
import { beforeEach, describe, mock, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { NextResponse } from 'next/server';
import { checkEnv } from '../src/core/infra/env.ts';
import * as privateImagePolicy from '../src/core/infra/private-image-policy.ts';
import { applyEnv } from './support/env.ts';

// Private image read and upload signing routes: the read route re-checks membership and streams
// only through Supabase, the sign route answers storage configuration failures as 503.

type S3Module = typeof import('../src/core/infra/s3.ts');

const PRIVATE_KEY =
	'manawg/989ac820-58b7-431f-9c65-28721264f333/expense/550e8400-e29b-41d4-a716-446655440000.png';
const KEY = PRIVATE_KEY;
const BODY = {
	shareCode: 'ABC12345',
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: 1024,
};
const SRC = path.join(import.meta.dirname, '..', 'src');
const S3_URL = pathToFileURL(path.join(SRC, 'core/infra/s3.ts')).href;
const S3_ENV_KEYS = [
	'AWS_REGION',
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'S3_BUCKET',
	'S3_PUBLIC_URL',
] as const;

const initialState = () => ({
	authenticatedUser: { id: 'user-1' } as { id: string } | null,
	authOutage: false,
	membership: 'active' as 'active' | 'foreign' | 'revoked',
	membershipCalls: 0,
	downloadCalls: 0,
	downloadedKeys: [] as string[],
	limitResult: { success: true } as {
		success: boolean;
		limiterUnavailable?: boolean;
		reset?: number;
	},
	dayLimitResult: { success: true } as { success: boolean; reset?: number },
});
let state = initialState();
beforeEach(() => {
	state = initialState();
});

// The s3 module reads its settings at load time: each scenario loads a fresh instance, and the
// sign route reaches it through this delegating mock.
let s3Impl: Record<string, unknown> = {};
let s3Loads = 0;
function loadS3(): Promise<S3Module> {
	s3Loads += 1;
	return import(`${S3_URL}?load=${s3Loads}`);
}

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			if (state.authOutage) throw new Error('AuthRetryableFetchError');
			return state.authenticatedUser;
		},
	},
});
mock.module('@/core/infra/observability', {
	namedExports: { logApiError: () => undefined, captureException: () => undefined },
});
mock.module('@/core/db/private-image-deletions', {
	namedExports: { isPrivateImageKeyRevoked: async () => false },
});
mock.module('@/core/db', {
	namedExports: { db: { query: { wgs: { findFirst: async () => ({ id: 'wg-1' }) } } } },
});
mock.module('@/core/guards/api-auth', {
	namedExports: {
		requireMember: async () => {
			state.membershipCalls += 1;
			return state.membership === 'active'
				? { ok: true, member: { memberId: 'member-1', name: 'Member' } }
				: {
						ok: false,
						response: NextResponse.json(
							{ error: state.membership === 'revoked' ? 'member_deactivated' : 'not_a_member' },
							{ status: 401 },
						),
					};
		},
	},
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError: class extends Error {},
		ImageStorageObjectNotFoundError: class extends Error {},
		getImageStorageProvider: () => 'aws',
		createSupabaseSignedUpload: async () => {
			throw new Error('supabase signing is not part of this contract');
		},
		downloadSupabaseImage: async (key: string) => {
			state.downloadCalls += 1;
			state.downloadedKeys.push(key);
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3]));
						controller.close();
					},
				}),
				contentType: 'image/png',
				contentLength: 3,
			};
		},
	},
});
const uploadSignDayLimiter = {};
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async (limiter: unknown) =>
			limiter === uploadSignDayLimiter ? state.dayLimitResult : state.limitResult,
		uploadSignLimiter: {},
		uploadSignDayLimiter,
	},
});
mock.module('@/core/infra/s3', {
	namedExports: {
		S3ConfigurationError: Object.defineProperty(
			function S3ConfigurationError() {},
			Symbol.hasInstance,
			{
				value: (value: unknown): boolean => {
					const configurationError = s3Impl.S3ConfigurationError;
					return typeof configurationError === 'function' && value instanceof configurationError;
				},
			},
		),
		S3_MAX_UPLOAD_BYTES: privateImagePolicy.PRIVATE_IMAGE_MAX_BYTES,
		createPresignedUpload: (...args: unknown[]) =>
			(s3Impl.createPresignedUpload as (...a: unknown[]) => Promise<unknown>)(...args),
		isAllowedMimeType: (mimeType: string) =>
			(s3Impl.isAllowedMimeType as (value: string) => boolean)(mimeType),
	},
});

const readRoute = await import('../src/app/api/upload/read/route.ts');
const signRoute = await import('../src/app/api/upload/sign/route.ts');

describe('private storage contract', () => {
	test('private reads use Supabase after an AWS rollback and re-check membership', async () => {
		const originalFetch = globalThis.fetch;
		let awsFetches = 0;
		globalThis.fetch = (async () => {
			awsFetches += 1;
			throw new Error('AWS private read must not fetch');
		}) as typeof fetch;
		const restoreEnv = applyEnv({ IMAGE_STORAGE_PROVIDER: 'aws' });
		const request = {
			nextUrl: new URL(
				`https://app.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			),
		} as never;

		try {
			// A transient Auth outage is retryable: 503, no-store, and no membership
			// lookup or storage read before the caller is known.
			state.authOutage = true;
			const outage = await readRoute.GET(request);
			assert.equal(outage.status, 503);
			assert.deepEqual(await outage.json(), { error: 'db_error' });
			assert.equal(outage.headers.get('cache-control'), 'no-store');
			assert.equal(state.membershipCalls, 0);
			assert.equal(state.downloadCalls, 0);
			state.authOutage = false;

			state.authenticatedUser = null;
			const guest = await readRoute.GET(request);
			assert.equal(guest.status, 401);
			assert.equal(state.downloadCalls, 0);

			state.authenticatedUser = { id: 'user-1' };
			state.membership = 'foreign';
			const foreign = await readRoute.GET(request);
			assert.equal(foreign.status, 401);
			assert.equal(state.downloadCalls, 0);

			state.membership = 'active';
			const response = await readRoute.GET(request);
			assert.equal(response.status, 200);
			assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
			assert.equal(response.headers.get('cache-control'), 'private, no-store');
			assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
			assert.equal(response.headers.get('location'), null);
			assert.deepEqual(state.downloadedKeys, [PRIVATE_KEY]);

			state.membership = 'revoked';
			const revoked = await readRoute.GET(request);
			assert.equal(revoked.status, 401);
			assert.equal(state.downloadCalls, 1);
			assert.equal(awsFetches, 0);
		} finally {
			globalThis.fetch = originalFetch;
			restoreEnv();
		}
	});
});

describe('upload sign s3 config contract', () => {
	function pinS3Env(values: Partial<Record<(typeof S3_ENV_KEYS)[number], string>>): () => void {
		return applyEnv({
			...Object.fromEntries(S3_ENV_KEYS.map((key) => [key, undefined])),
			...values,
		});
	}

	/** Loads a fresh s3 module under the pinned env and routes the sign route through it. */
	async function useS3(): Promise<S3Module> {
		const s3 = await loadS3();
		s3Impl = s3 as unknown as Record<string, unknown>;
		return s3;
	}

	async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
		try {
			await run();
		} catch (error) {
			return error;
		}
		throw new Error('expected the call to reject');
	}

	function post(): Promise<Response> {
		return signRoute.POST(
			new Request('https://example.invalid/api/upload/sign', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(BODY),
			}) as never,
		);
	}

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
				const s3 = await useS3();
				const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
				assert.ok(error instanceof s3.S3ConfigurationError);
				const response = await post();
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
			await useS3();
			state.limitResult = {
				success: false,
				limiterUnavailable: true,
				reset: Date.now() + 60_000,
			};
			const response = await post();
			assert.equal(response.status, 503);
			assert.equal((await response.json()).error, 'rate_limiter_unavailable');
			assert.notEqual(response.headers.get('retry-after'), null);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restore();
		}
	});

	test('upload signing stops at the per-WG daily quota', async () => {
		const restore = pinS3Env({});
		try {
			await useS3();
			state.dayLimitResult = { success: false, reset: Date.now() + 60_000 };
			const response = await post();
			assert.equal(response.status, 429);
			assert.equal((await response.json()).error, 'upload_sign_rate_limited');
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restore();
		}
	});

	test('the sign route answers 503 feature_disabled for S3 configuration failures', async () => {
		const restoreNoBucket = pinS3Env({});
		try {
			await useS3();
			const response = await post();
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
			await useS3();
			const response = await post();
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
		s3Impl = {
			S3ConfigurationError: class extends Error {},
			isAllowedMimeType: () => true,
			createPresignedUpload: async () => {
				throw new Error(
					'S3 credentials missing. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.',
				);
			},
		};
		const response = await post();

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
			await useS3();
			const response = await post();
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
