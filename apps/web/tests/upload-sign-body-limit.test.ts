import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { NextRequest } from 'next/server';

// The body cap runs before authentication: an oversized anonymous request must not reach the
// Supabase user lookup or the database.

let authCalls = 0;
let databaseCalls = 0;

mock.module('@/core/auth/server', {
	namedExports: {
		getAuthenticatedUser: async () => {
			authCalls += 1;
			return null;
		},
	},
});
mock.module('@/core/db', {
	namedExports: {
		db: {
			query: {
				wgs: {
					findFirst: async () => {
						databaseCalls += 1;
						return null;
					},
				},
			},
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
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), uploadSignLimiter: null },
});
mock.module('@/core/validators/image-url', {
	namedExports: { getPrivateImageUrl: () => 'https://example.invalid/image' },
});
mock.module('@/core/utils/share-code', {
	namedExports: {
		isValidShareCode: () => true,
		normalizeShareCode: (value: string) => value,
	},
});

const route = await import('../src/app/api/upload/sign/route');

test('upload-sign rejects an oversized unauthenticated JSON body before auth or database work', async () => {
	const body = 'x'.repeat(16 * 1024 + 1);
	const request = new NextRequest('https://example.invalid/api/upload/sign', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
	const response = await route.POST(request);
	assert.equal(response.status, 413);
	assert.deepEqual(await response.json(), {
		error: 'payload_too_large',
		code: 'payload_too_large',
	});
	assert.equal(response.headers.get('cache-control'), 'no-store');
	assert.equal(authCalls, 0);
	assert.equal(databaseCalls, 0);
});
