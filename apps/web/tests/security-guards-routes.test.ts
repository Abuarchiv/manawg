import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { inspect } from 'node:util';
import { verifyLegacyClaimProof } from '../src/core/guards/legacy-claim-proof.ts';
import { captureException, logApiError } from '../src/core/infra/observability.ts';

// Trust-boundary contracts of guards and API routes: membership checks (no 404 oracle), the
// legacy claim proof, redacted error reporting and early rejection in the health and
// upload-sign routes.

const readSource = (relativePath: string) =>
	readFile(path.join(import.meta.dirname, '..', 'src', relativePath), 'utf8');

const routeState = { databaseCalls: 0, authCalls: 0, limiterUnavailable: true };

mock.module('@/core/infra/env', {
	namedExports: { checkEnv: () => ({ ok: true, missingRequired: [], degraded: [] }) },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		checkRateLimit: async () =>
			routeState.limiterUnavailable
				? {
						success: false,
						remaining: 0,
						reset: Date.now() + 60_000,
						limiterUnavailable: true,
					}
				: { success: true },
		clientIpKey: () => '127.0.0.1',
		healthLimiter: null,
		uploadSignLimiter: null,
	},
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			execute: async () => {
				routeState.databaseCalls += 1;
			},
			query: {
				wgs: {
					findFirst: async () => {
						routeState.databaseCalls += 1;
						return null;
					},
				},
			},
		},
	},
});
mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			routeState.authCalls += 1;
			return null;
		},
	},
});
mock.module('@/core/guards/api-auth', {
	namedExports: { requireMember: async () => ({ ok: false }) },
});
mock.module('@/core/infra/s3', {
	namedExports: {
		S3ConfigurationError: class extends Error {},
		S3_MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
		createPresignedUpload: async () => ({}),
		isAllowedMimeType: () => true,
	},
});
mock.module('@/core/infra/supabase-storage', {
	namedExports: {
		ImageStorageConfigurationError: class extends Error {},
		createSupabaseSignedUpload: async () => ({}),
		getImageStorageProvider: () => 'aws',
	},
});
mock.module('@/core/validators/image-url', {
	namedExports: { getPrivateImageUrl: () => 'https://example.invalid/image' },
});

const health = await import('../src/app/api/health/route.ts');
const uploadSign = await import('../src/app/api/upload/sign/route.ts');

describe('require wg member regression', () => {
	test('WG root verifies identity before looking up a live share code', async () => {
		const source = await readSource('app/api/wg/[code]/route.ts');
		const getHandler = source
			.split('export async function GET(')[1]
			?.split('export async function PATCH(')[0];
		if (!getHandler) throw new Error('GET handler not found');
		// requireWgMembership authenticates the Supabase user before it runs the WG lookup.
		assert.ok(
			getHandler.indexOf('readShareCode(ctx)') <
				getHandler.indexOf('requireWgMembership(req, code'),
		);
		const guard = await readSource('core/guards/require-wg-member.ts');
		assert.ok(guard.indexOf('getAuthenticatedUser(req)') < guard.indexOf('loadWg(code)'));
		assert.ok(guard.indexOf('loadWg(code)') < guard.indexOf('requireMember(req, wg.id, user)'));
	});
});

describe('legacy claim proof', () => {
	const wgId = '989ac820-58b7-431f-9c65-28721264f333';
	const memberId = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

	test('legacy claim proof accepts the stored HMAC and rejects trailing data or a missing secret', () => {
		const previousSecret = process.env.MEMBER_SESSION_SECRET;
		process.env.MEMBER_SESSION_SECRET = 'auth-regression-secret';
		try {
			const token = createHmac('sha256', 'auth-regression-secret')
				.update(`${wgId}:${memberId}`)
				.digest('hex');
			assert.equal(verifyLegacyClaimProof(wgId, memberId, token), true);
			assert.equal(verifyLegacyClaimProof(wgId, memberId, `${token}g`), false);
			assert.equal(verifyLegacyClaimProof(wgId, memberId, null), false);
			Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
			assert.equal(verifyLegacyClaimProof(wgId, memberId, token), false);
		} finally {
			if (previousSecret === undefined)
				Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
			else process.env.MEMBER_SESSION_SECRET = previousSecret;
		}
	});

	test('normal server membership derives identity from auth alone, without member tokens', async () => {
		const source = await readSource('core/guards/api-auth.ts');
		assert.ok(source.includes('eq(wgMembers.authUserId, user.id)'));
		assert.ok(!source.includes('legacy-claim-proof'));
		assert.ok(!source.includes('LEGACY_CLAIM'));
	});
});

describe('api infra security contracts', () => {
	test('central error reporting redacts thrown messages and arbitrary context while keeping route labels', () => {
		const calls: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => calls.push(args);
		try {
			const providerPayload = 'PostgresError: password=private-db-payload';
			captureException(new Error(providerPayload), {
				boundary: 'wg-code',
				query: providerPayload,
				cronJob: 'privatepayload',
			});
			logApiError('[expenses GET]', new Error(providerPayload));

			const output = inspect(calls, { depth: 8 });
			assert.ok(!output.includes(providerPayload));
			assert.ok(!output.includes('privatepayload'));
			assert.ok(!output.includes('query:'));
			assert.ok(output.includes('wg-code'));
			assert.ok(output.includes('[expenses GET]'));
		} finally {
			console.error = original;
		}
	});

	test('health reports an unavailable limiter as 503 instead of rate limiting', async () => {
		routeState.databaseCalls = 0;
		routeState.limiterUnavailable = true;

		const response = await health.GET(new Request('https://example.invalid/api/health') as never);
		assert.equal(response.status, 503);
		assert.equal((await response.json()).error, 'rate_limiter_unavailable');
		assert.notEqual(response.headers.get('retry-after'), null);
		assert.equal(routeState.databaseCalls, 0);
	});

	test('upload-sign rejects an oversized unauthenticated JSON body before auth or database work', async () => {
		routeState.databaseCalls = 0;
		routeState.authCalls = 0;
		routeState.limiterUnavailable = false;

		const request = new Request('https://example.invalid/api/upload/sign', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'x'.repeat(16 * 1024 + 1),
		});
		const response = await uploadSign.POST(request as never);
		assert.equal(response.status, 413);
		assert.deepEqual(await response.json(), {
			error: 'payload_too_large',
			code: 'payload_too_large',
		});
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(routeState.authCalls, 0);
		assert.equal(routeState.databaseCalls, 0);
	});
});
