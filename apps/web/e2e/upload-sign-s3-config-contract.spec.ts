import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { readJsonBody } from '../src/core/http/read-json';
import { checkEnv } from '../src/core/infra/env';
import * as privateImagePolicy from '../src/core/infra/private-image-policy';
import * as shareCode from '../src/core/utils/share-code';

type S3Module = typeof import('../src/core/infra/s3');

interface SignRoute {
	POST: (req: Request) => Promise<Response>;
}

const S3_PATH = path.join(process.cwd(), 'src/core/infra/s3.ts');
const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/upload/sign/route.ts');
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

function loadTs<T>(filePath: string, overrides: Record<string, unknown> = {}): T {
	const compiled = transpileModule(readFileSync(filePath, 'utf8'), {
		compilerOptions: {
			module: ModuleKind.CommonJS,
			target: ScriptTarget.ES2022,
			esModuleInterop: true,
		},
	}).outputText;
	const module = { exports: {} as Record<string, unknown> };
	const realRequire = createRequire(filePath);
	const localRequire = (id: string): unknown =>
		Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
	new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
	return module.exports as T;
}

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

function loadS3(): S3Module {
	return loadTs<S3Module>(S3_PATH, { './private-image-policy': privateImagePolicy });
}

function loadRoute(
	s3: unknown,
	limitResult: { success: boolean; limiterUnavailable?: boolean; reset?: number } = {
		success: true,
	},
): SignRoute {
	const nextServer = createRequire(ROUTE_PATH)('next/server') as typeof import('next/server');
	const json = (body: unknown, status: number) =>
		nextServer.NextResponse.json(body as Record<string, unknown>, { status });
	return loadTs<SignRoute>(ROUTE_PATH, {
		'@/core/auth/server': { getAuthenticatedUser: async () => ({ id: 'user-1' }) },
		'@/core/db': {
			db: { query: { wgs: { findFirst: async () => ({ id: 'wg-1' }) } } },
		},
		'@/core/http/api-errors': {
			apiError: (message: string, status: number, code?: string) =>
				json(code !== undefined ? { error: message, code } : { error: message }, status),
			badRequest: (message: string) => json({ error: message }, 400),
			notFound: (message: string) => json({ error: message }, 404),
			tooMany: (message: string, code?: string) =>
				json(code !== undefined ? { error: message, code } : { error: message }, 429),
			serverError: (message: string) => json({ error: message }, 500),
		},
		'@/core/guards/api-auth': {
			requireMember: async () => ({
				ok: true,
				member: { memberId: 'member-1', name: 'Member', verified: true },
			}),
		},
		'@/core/http/read-json': { readJsonBody },
		'@/core/infra/private-image-policy': privateImagePolicy,
		'@/core/infra/s3': s3,
		'@/core/infra/supabase-storage': {
			ImageStorageConfigurationError: class extends Error {},
			getImageStorageProvider: () => 'aws',
			createSupabaseSignedUpload: async () => {
				throw new Error('supabase signing is not part of this contract');
			},
		},
		'@/core/rate-limit': {
			checkRateLimit: async () => limitResult,
			uploadSignLimiter: {},
		},
		'@/core/validators/image-url': {
			getPrivateImageUrl: (key: string) => `https://images.example/${key}`,
		},
		'@/core/utils/share-code': shareCode,
	});
}

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('expected the call to reject');
}

async function post(route: SignRoute): Promise<Response> {
	return route.POST(
		new Request('https://example.invalid/api/upload/sign', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(BODY),
		}),
	);
}

test('missing S3 configuration throws a typed S3ConfigurationError', async () => {
	const restoreEmpty = pinS3Env({});
	try {
		const s3 = loadS3();
		const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
		expect(error).toBeInstanceOf(s3.S3ConfigurationError);
	} finally {
		restoreEmpty();
	}

	const restoreNoKeys = pinS3Env({ S3_BUCKET: 'manawg-bucket', AWS_REGION: 'us-east-1' });
	try {
		const s3 = loadS3();
		const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
		expect(error).toBeInstanceOf(s3.S3ConfigurationError);
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
		expect(checkEnv({ ...config, VERCEL_ENV: 'production' }).missingRequired).toContain(
			'S3_PUBLIC_URL',
		);
		const restore = pinS3Env(config);
		try {
			const s3 = loadS3();
			const error = await captureFailure(() => s3.createPresignedUpload(KEY, 'image/png', 10));
			expect(error).toBeInstanceOf(s3.S3ConfigurationError);
			const response = await post(loadRoute(s3));
			expect(response.status).toBe(503);
			expect(await response.json()).toEqual({
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
		const response = await post(
			loadRoute(loadS3(), {
				success: false,
				limiterUnavailable: true,
				reset: Date.now() + 60_000,
			}),
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ error: 'rate_limiter_unavailable' });
		expect(response.headers.get('retry-after')).not.toBeNull();
		expect(response.headers.get('cache-control')).toBe('no-store');
	} finally {
		restore();
	}
});

test('the sign route answers 503 feature_disabled for S3 configuration failures', async () => {
	const restoreNoBucket = pinS3Env({});
	try {
		const response = await post(loadRoute(loadS3()));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: 'feature_disabled',
			code: 'image_uploads_unavailable',
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
	} finally {
		restoreNoBucket();
	}

	const restoreNoKeys = pinS3Env({ S3_BUCKET: 'manawg-bucket', AWS_REGION: 'us-east-1' });
	try {
		const response = await post(loadRoute(loadS3()));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: 'feature_disabled',
			code: 'image_uploads_unavailable',
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
	} finally {
		restoreNoKeys();
	}
});

test('the sign route keeps unrelated S3 failures as a 500 sign_failed', async () => {
	const legacyMessageError = {
		S3ConfigurationError: class extends Error {},
		S3_MAX_UPLOAD_BYTES: privateImagePolicy.PRIVATE_IMAGE_MAX_BYTES,
		isAllowedMimeType: () => true,
		createPresignedUpload: async () => {
			throw new Error(
				'S3 credentials missing. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.',
			);
		},
	};
	const response = await post(loadRoute(legacyMessageError));

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ error: 'sign_failed' });
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
		const response = await post(loadRoute(loadS3()));
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			presignedUrl: string;
			publicUrl: string;
			maxFileSize: number;
		};
		expect(body.presignedUrl).toContain('X-Amz-Signature');
		expect(body.maxFileSize).toBe(8 * 1024 * 1024);
		expect(body.publicUrl).toMatch(
			/^https:\/\/cdn\.example\.com\/manawg\/wg-1\/expense\/[0-9a-f-]{36}\.png$/,
		);
		expect(response.headers.get('cache-control')).toBe('no-store');
	} finally {
		restore();
	}
});
