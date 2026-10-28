import assert from 'node:assert/strict';
import { beforeEach, describe, mock, test } from 'node:test';
import { NextResponse } from 'next/server';
import { applyEnv } from './support/env.ts';

// Private image read and upload signing routes: the read route re-checks membership and streams
// only through Supabase, the sign route answers storage configuration failures as 503.

const PRIVATE_KEY =
	'manawg/989ac820-58b7-431f-9c65-28721264f333/expense/550e8400-e29b-41d4-a716-446655440000.png';
const BODY = {
	shareCode: 'ABC12345',
	purpose: 'expense',
	mimeType: 'image/png',
	fileSize: 1024,
};
const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
class ImageStorageConfigurationError extends Error {}

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
	signUpload: async (_key: string, _contentType: string): Promise<unknown> => ({
		presignedUrl: 'https://app.example/storage/v1/object/upload/sign/private/key?token=t',
		maxFileSize: 8 * 1024 * 1024,
		uploadHeaders: { 'Cache-Control': 'max-age=0' },
	}),
});
let state = initialState();
beforeEach(() => {
	state = initialState();
});

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
	namedExports: { db: { query: { wgs: { findFirst: async () => ({ id: WG_ID }) } } } },
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
		ImageStorageConfigurationError,
		ImageStorageObjectNotFoundError: class extends Error {},
		createSupabaseSignedUpload: (key: string, contentType: string) =>
			state.signUpload(key, contentType),
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
const readRoute = await import('../src/app/api/upload/read/route.ts');
const signRoute = await import('../src/app/api/upload/sign/route.ts');

describe('private storage contract', () => {
	test('private reads stream from Supabase and re-check membership', async () => {
		const originalFetch = globalThis.fetch;
		let directFetches = 0;
		globalThis.fetch = (async () => {
			directFetches += 1;
			throw new Error('private reads must not fetch directly');
		}) as typeof fetch;
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
			assert.equal(directFetches, 0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe('upload sign contract', () => {
	function post(): Promise<Response> {
		return signRoute.POST(
			new Request('https://example.invalid/api/upload/sign', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(BODY),
			}) as never,
		);
	}

	test('upload signing reports an unavailable limiter as 503 with a retry hint', async () => {
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
	});

	test('upload signing stops at the per-WG daily quota', async () => {
		state.dayLimitResult = { success: false, reset: Date.now() + 60_000 };
		const response = await post();
		assert.equal(response.status, 429);
		assert.equal((await response.json()).error, 'upload_sign_rate_limited');
		assert.equal(response.headers.get('cache-control'), 'no-store');
	});

	test('the sign route answers 503 feature_disabled for storage configuration failures', async () => {
		state.signUpload = async () => {
			throw new ImageStorageConfigurationError();
		};
		const response = await post();
		assert.equal(response.status, 503);
		assert.deepEqual(await response.json(), {
			error: 'feature_disabled',
			code: 'image_uploads_unavailable',
		});
		assert.equal(response.headers.get('cache-control'), 'no-store');
	});

	test('the sign route keeps unrelated storage failures as a 500 sign_failed', async () => {
		state.signUpload = async () => {
			throw new Error('storage answered 500');
		};
		const response = await post();

		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), { error: 'sign_failed' });
	});

	test('the sign route returns a signed Supabase upload and the private read URL', async () => {
		const signed: string[] = [];
		state.signUpload = async (key, contentType) => {
			signed.push(`${key} ${contentType}`);
			return {
				presignedUrl: 'https://app.example/storage/v1/object/upload/sign/private/key?token=t',
				maxFileSize: 8 * 1024 * 1024,
				uploadHeaders: { 'Cache-Control': 'max-age=0' },
			};
		};
		const restore = applyEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example', VERCEL_URL: undefined });
		try {
			const response = await post();
			assert.equal(response.status, 200);
			const body = (await response.json()) as {
				presignedUrl: string;
				publicUrl: string;
				maxFileSize: number;
			};
			assert.match(
				signed[0] ?? '',
				new RegExp(`^manawg/${WG_ID}/expense/[0-9a-f-]{36}\\.png image/png$`),
			);
			assert.equal(
				body.publicUrl,
				`https://app.example/api/upload/read?key=${encodeURIComponent(signed[0]?.split(' ')[0] ?? '')}`,
			);
			assert.ok(body.presignedUrl.includes('/storage/v1/object/upload/sign/'));
			assert.equal(body.maxFileSize, 8 * 1024 * 1024);
			assert.equal(response.headers.get('cache-control'), 'no-store');
		} finally {
			restore();
		}
	});
});
