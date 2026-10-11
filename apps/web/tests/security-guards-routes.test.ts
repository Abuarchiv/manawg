import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { inspect } from 'node:util';
import { captureException, logApiError } from '../src/core/infra/observability.ts';

// Trust-boundary contracts of guards and API routes: redacted error reporting and early rejection in the health and
// upload-sign routes.

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
		uploadSignDayLimiter: null,
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
