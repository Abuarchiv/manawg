// Private attachments and upload signing: URL validation, storage provider contracts, S3 config and
// draft recovery. Protects against path traversal and leaking private object URLs.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { readJsonBody } from '../src/core/http/read-json';
import { checkEnv } from '../src/core/infra/env';
import * as privateImagePolicy from '../src/core/infra/private-image-policy';
import {
	PRIVATE_IMAGE_MAX_BYTES,
	isAllowedPrivateImageMimeType,
	isValidPrivateImageSize,
} from '../src/core/infra/private-image-policy';
import { buildDraftKey } from '../src/core/offline/drafts';
import * as shareCode from '../src/core/utils/share-code';
import {
	getPrivateImageUrl,
	imageUrlSchema,
	isAllowedImageUrlForWg,
	parsePrivateImageKey,
} from '../src/core/validators/image-url';
import { FIXTURE_WG, dismissOnboarding, navigateToFeature, setupMember } from './_helpers';

test.describe('private image url', () => {
	const WG_A = '11111111-1111-4111-8111-111111111111';
	const WG_B = '22222222-2222-4222-8222-222222222222';
	const IMAGE_ID = '33333333-3333-4333-8333-333333333333';
	const PRIVATE_KEY = `manawg/${WG_A}/expense/${IMAGE_ID}.webp`;

	const ENV_KEYS = [
		'VERCEL_URL',
		'VERCEL_ENV',
		'NEXT_PUBLIC_APP_URL',
		'S3_PUBLIC_URL',
		'S3_BUCKET',
		'AWS_REGION',
		'IMAGE_STORAGE_PROVIDER',
		'SUPABASE_SERVICE_ROLE_KEY',
		'SUPABASE_STORAGE_BUCKET',
	] as const;

	const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

	function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
		for (const [key, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	function baseEnv(): Record<string, string> {
		return {
			POSTGRES_URL: 'postgres://user:pass@host/db',
			MEMBER_SESSION_SECRET: 'session-secret',
			NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
			NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
			VERCEL_ENV: 'preview',
			AWS_ACCESS_KEY_ID: 'aws-key',
			AWS_SECRET_ACCESS_KEY: 'aws-secret',
			AWS_REGION: 'eu-central-1',
			S3_BUCKET: 'legacy-bucket',
		};
	}

	test.describe('private image URL contract', () => {
		test.describe.configure({ mode: 'serial' });

		test.beforeEach(() => {
			setEnv({
				VERCEL_URL: 'preview.manawg.example',
				VERCEL_ENV: 'preview',
				NEXT_PUBLIC_APP_URL: 'https://manawg.com',
				S3_PUBLIC_URL: 'https://legacy-bucket.s3.eu-central-1.amazonaws.com',
				S3_BUCKET: 'legacy-bucket',
				AWS_REGION: 'eu-central-1',
				IMAGE_STORAGE_PROVIDER: undefined,
			});
		});

		test.afterAll(() => {
			for (const [key, value] of originalEnv) setEnv({ [key]: value });
		});

		test('parses only the exact WG-scoped private key grammar', () => {
			expect(parsePrivateImageKey(PRIVATE_KEY)).toEqual({ wgId: WG_A });
			expect(parsePrivateImageKey(`manawg/${WG_A}/announcement/${IMAGE_ID}.heif`)).toEqual({
				wgId: WG_A,
			});
			expect(parsePrivateImageKey(`manawg/${WG_A}/expense/${IMAGE_ID}.jpg/extra`)).toBeNull();
			expect(parsePrivateImageKey(`manawg/${WG_A}/expense/../${IMAGE_ID}.jpg`)).toBeNull();
			expect(parsePrivateImageKey(`manawg/${WG_A}/other/${IMAGE_ID}.jpg`)).toBeNull();
			expect(parsePrivateImageKey(`manawg/${WG_A}/expense/${IMAGE_ID}.gif`)).toBeNull();
		});

		test('uses the trusted Preview origin and enforces the destination WG', () => {
			const url = getPrivateImageUrl(PRIVATE_KEY);

			expect(url).toBe(
				`https://preview.manawg.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			);
			expect(imageUrlSchema.safeParse(url).success).toBe(true);
			expect(isAllowedImageUrlForWg(url, WG_A)).toBe(true);
			expect(isAllowedImageUrlForWg(url, WG_B)).toBe(false);
			expect(
				imageUrlSchema.safeParse(
					`https://preview.manawg.example/api/upload/read?key=${PRIVATE_KEY}`,
				).success,
			).toBe(true);
		});

		test('uses the stable configured origin outside Preview', () => {
			setEnv({ VERCEL_ENV: 'production', VERCEL_URL: 'preview.manawg.example' });

			expect(getPrivateImageUrl(PRIVATE_KEY)).toBe(
				`https://manawg.com/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			);
		});

		test('rejects private read URLs with credentials', () => {
			const url = `https://user:pass@preview.manawg.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`;

			expect(imageUrlSchema.safeParse(url).success).toBe(false);
			expect(isAllowedImageUrlForWg(url, WG_A)).toBe(false);
		});

		test('rejects public HTTP in production but permits explicit local development hosts', () => {
			setEnv({
				VERCEL_ENV: 'production',
				VERCEL_URL: 'preview.manawg.example',
				NEXT_PUBLIC_APP_URL: 'http://manawg.com',
			});

			expect(() => getPrivateImageUrl(PRIVATE_KEY)).toThrow();
			expect(
				imageUrlSchema.safeParse(
					`http://manawg.com/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
				).success,
			).toBe(false);

			for (const host of ['localhost', '127.0.0.1', '[::1]']) {
				setEnv({
					VERCEL_ENV: 'development',
					VERCEL_URL: undefined,
					NEXT_PUBLIC_APP_URL: `http://${host}:3000`,
				});
				const localUrl = getPrivateImageUrl(PRIVATE_KEY);

				expect(localUrl).toBe(
					`http://${host}:3000/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
				);
				expect(imageUrlSchema.safeParse(localUrl).success).toBe(true);
			}
		});

		test('rejects foreign origins, traversal, fragments, and extra query parameters', () => {
			const encodedKey = encodeURIComponent(PRIVATE_KEY);
			const invalidUrls = [
				`https://evil.example/api/upload/read?key=${encodedKey}`,
				`https://preview.manawg.example/api/upload/read/extra?key=${encodedKey}`,
				`https://preview.manawg.example/api/upload/../upload/read?key=${encodedKey}`,
				`https://preview.manawg.example/api/upload/read?key=${encodedKey}#fragment`,
				`https://preview.manawg.example/api/upload/read?key=${encodedKey}&extra=1`,
				`https://preview.manawg.example/api/upload/read?key=${encodedKey}&key=${encodedKey}`,
			];

			for (const url of invalidUrls) {
				expect(imageUrlSchema.safeParse(url).success).toBe(false);
				expect(isAllowedImageUrlForWg(url, WG_A)).toBe(false);
			}
		});

		test('preserves the legacy AWS allowlist behavior', () => {
			expect(
				imageUrlSchema.safeParse(
					'https://legacy-bucket.s3.eu-central-1.amazonaws.com/anything.jpg?cache=1',
				).success,
			).toBe(true);
			expect(
				imageUrlSchema.safeParse('https://legacy-bucket.s3.amazonaws.com/anything.jpg').success,
			).toBe(true);
			expect(
				imageUrlSchema.safeParse('https://other-bucket.s3.eu-central-1.amazonaws.com/x.jpg')
					.success,
			).toBe(false);
		});

		test('reports explicit provider requirements without changing the AWS default', () => {
			const aws = checkEnv(baseEnv());
			expect(aws.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

			const supabase = checkEnv({
				...baseEnv(),
				IMAGE_STORAGE_PROVIDER: 'supabase',
				SUPABASE_SERVICE_ROLE_KEY: 'server-key',
				SUPABASE_STORAGE_BUCKET: 'private-images',
			});
			expect(supabase.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

			const maskedValues = checkEnv({
				...baseEnv(),
				IMAGE_STORAGE_PROVIDER: 'supabase',
				SUPABASE_SERVICE_ROLE_KEY: '********',
				SUPABASE_STORAGE_BUCKET: 'private-images',
			});
			expect(maskedValues.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

			const unknown = checkEnv({ ...baseEnv(), IMAGE_STORAGE_PROVIDER: 'unknown' });
			const unknownImage = unknown.degraded.find((entry) => entry.feature === 'image-uploads');
			expect(unknownImage?.missing).toContain('IMAGE_STORAGE_PROVIDER');

			const invalidSupabase = checkEnv({
				...baseEnv(),
				IMAGE_STORAGE_PROVIDER: 'supabase',
				NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
				SUPABASE_STORAGE_BUCKET: '',
				SUPABASE_SERVICE_ROLE_KEY: '',
			});
			const invalidImage = invalidSupabase.degraded.find(
				(entry) => entry.feature === 'image-uploads',
			);
			expect(invalidImage?.missing).toEqual(
				expect.arrayContaining([
					'NEXT_PUBLIC_SUPABASE_URL',
					'SUPABASE_STORAGE_BUCKET',
					'SUPABASE_SERVICE_ROLE_KEY',
				]),
			);
		});

		test('makes the configured provider storage variables fatal in production', () => {
			const productionEnv = (): Record<string, string> => ({
				...baseEnv(),
				VERCEL_ENV: 'production',
				CRON_SECRET: 'cron-secret',
				UPSTASH_REDIS_REST_URL: 'https://redis.example',
				UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
				SUPABASE_SERVICE_ROLE_KEY: 'server-key',
			});

			const complete = checkEnv(productionEnv());
			expect(complete.ok).toBe(true);

			const missingRegion = checkEnv(
				(({ AWS_REGION: _dropped, ...rest }) => rest)(productionEnv()),
			);
			expect(missingRegion.ok).toBe(false);
			expect(missingRegion.missingRequired).toContain('AWS_REGION');
			// Production reports the missing variable as required instead of
			// downgrading it to a degraded feature.
			expect(missingRegion.degraded.some((entry) => entry.feature === 'image-uploads')).toBe(false);

			const supabase = checkEnv({
				...productionEnv(),
				IMAGE_STORAGE_PROVIDER: 'supabase',
				SUPABASE_SERVICE_ROLE_KEY: 'server-key',
				SUPABASE_STORAGE_BUCKET: '',
			});
			expect(supabase.ok).toBe(false);
			expect(supabase.missingRequired).toContain('SUPABASE_STORAGE_BUCKET');

			const withoutServiceRole = checkEnv(
				(({ SUPABASE_SERVICE_ROLE_KEY: _dropped, ...rest }) => rest)(productionEnv()),
			);
			expect(withoutServiceRole.ok).toBe(false);
			expect(withoutServiceRole.missingRequired).toContain('SUPABASE_SERVICE_ROLE_KEY');
		});
	});
});

test.describe('private storage contract', () => {
	const PRIVATE_KEY =
		'manawg/989ac820-58b7-431f-9c65-28721264f333/expense/550e8400-e29b-41d4-a716-446655440000.png';

	async function readSource(relativePath: string): Promise<string> {
		return readFile(path.join(process.cwd(), 'src', relativePath), 'utf8');
	}

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

	test('private image policy accepts only the exact size and MIME allowlist', () => {
		expect(PRIVATE_IMAGE_MAX_BYTES).toBe(8 * 1024 * 1024);
		for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
			expect(isAllowedPrivateImageMimeType(mimeType)).toBe(true);
		}
		expect(isAllowedPrivateImageMimeType('image/gif')).toBe(false);
		expect(isValidPrivateImageSize(PRIVATE_IMAGE_MAX_BYTES)).toBe(true);
		expect(isValidPrivateImageSize(PRIVATE_IMAGE_MAX_BYTES + 1)).toBe(false);
		expect(isValidPrivateImageSize(0)).toBe(false);
	});

	test('private keys reject traversal and preserve WG scoping', () => {
		expect(parsePrivateImageKey('../outside.png')).toBeNull();
		expect(parsePrivateImageKey('manawg/not-a-uuid/expense/image.png')).toBeNull();
	});

	test('private reads use Supabase after an AWS rollback and re-check membership', async () => {
		const routePath = path.join(process.cwd(), 'src/app/api/upload/read/route.ts');
		const imageUrl = loadTs<{ parsePrivateImageKey: typeof parsePrivateImageKey }>(
			path.join(process.cwd(), 'src/core/validators/image-url.ts'),
		);
		const nextServer = createRequire(routePath)('next/server') as typeof import('next/server');
		let authenticatedUser: { id: string } | null = { id: 'user-1' };
		let authOutage = false;
		let membership: 'active' | 'foreign' | 'revoked' = 'active';
		let membershipCalls = 0;
		let downloadCalls = 0;
		const downloadedKeys: string[] = [];

		const storageErrors = {
			ImageStorageConfigurationError: class extends Error {},
			ImageStorageObjectNotFoundError: class extends Error {},
		};
		const route = loadTs<{ GET: (request: { nextUrl: URL }) => Promise<Response> }>(routePath, {
			'@/core/auth/server': {
				getAuthenticatedUser: async () => {
					if (authOutage) throw new Error('AuthRetryableFetchError');
					return authenticatedUser;
				},
			},
			'@/core/infra/observability': { logApiError: () => undefined },
			'@/core/db/private-image-deletions': {
				isPrivateImageKeyRevoked: async () => false,
			},
			'@/core/http/api-errors': {
				apiError: (message: string, status: number, code?: string) =>
					nextServer.NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status }),
				badRequest: (message: string) =>
					nextServer.NextResponse.json({ error: message }, { status: 400 }),
				notFound: (message: string) =>
					nextServer.NextResponse.json({ error: message }, { status: 404 }),
				serverError: (message: string) =>
					nextServer.NextResponse.json({ error: message }, { status: 500 }),
				serviceUnavailable: (message: string) =>
					nextServer.NextResponse.json({ error: message }, { status: 503 }),
				unauthorized: (message: string, code?: string) =>
					nextServer.NextResponse.json(
						{ error: message, ...(code ? { code } : {}) },
						{ status: 401 },
					),
			},
			'@/core/guards/api-auth': {
				requireMember: async () => {
					membershipCalls += 1;
					return membership === 'active'
						? { ok: true, member: { memberId: 'member-1', name: 'Member' } }
						: {
								ok: false,
								response: nextServer.NextResponse.json(
									{ error: membership === 'revoked' ? 'member_deactivated' : 'not_a_member' },
									{ status: 401 },
								),
							};
				},
			},
			'@/core/infra/supabase-storage': {
				...storageErrors,
				downloadSupabaseImage: async (key: string) => {
					downloadCalls += 1;
					downloadedKeys.push(key);
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
			'@/core/validators/image-url': imageUrl,
		});

		const originalProvider = process.env.IMAGE_STORAGE_PROVIDER;
		const originalFetch = globalThis.fetch;
		let awsFetches = 0;
		globalThis.fetch = (async () => {
			awsFetches += 1;
			throw new Error('AWS private read must not fetch');
		}) as typeof fetch;
		process.env.IMAGE_STORAGE_PROVIDER = 'aws';
		const request = {
			nextUrl: new URL(
				`https://app.example/api/upload/read?key=${encodeURIComponent(PRIVATE_KEY)}`,
			),
		};

		try {
			// A transient Auth outage is retryable: 503, no-store, and no membership
			// lookup or storage read before the caller is known.
			authOutage = true;
			const outage = await route.GET(request);
			expect(outage.status).toBe(503);
			expect(await outage.json()).toEqual({ error: 'db_error' });
			expect(outage.headers.get('cache-control')).toBe('no-store');
			expect(membershipCalls).toBe(0);
			expect(downloadCalls).toBe(0);
			authOutage = false;

			authenticatedUser = null;
			const guest = await route.GET(request);
			expect(guest.status).toBe(401);
			expect(downloadCalls).toBe(0);

			authenticatedUser = { id: 'user-1' };
			membership = 'foreign';
			const foreign = await route.GET(request);
			expect(foreign.status).toBe(401);
			expect(downloadCalls).toBe(0);

			membership = 'active';
			const response = await route.GET(request);
			expect(response.status).toBe(200);
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('location')).toBeNull();
			expect(downloadedKeys).toEqual([PRIVATE_KEY]);

			membership = 'revoked';
			const revoked = await route.GET(request);
			expect(revoked.status).toBe(401);
			expect(downloadCalls).toBe(1);
			expect(awsFetches).toBe(0);
		} finally {
			globalThis.fetch = originalFetch;
			if (originalProvider === undefined)
				Reflect.deleteProperty(process.env, 'IMAGE_STORAGE_PROVIDER');
			else process.env.IMAGE_STORAGE_PROVIDER = originalProvider;
		}
	});

	test('private read authenticates malformed and foreign keys before streaming bytes', async () => {
		const source = await readSource('app/api/upload/read/route.ts');

		expect(source).toContain('parsePrivateImageKey');
		expect(source).toContain('getAuthenticatedUser');
		expect(source).toContain('requireMember');
		expect(source).toContain("unauthorized('auth_required'");
		expect(source).toContain('if (!auth.ok) return noStore(auth.response)');
		expect(source).toContain('downloadSupabaseImage');
		expect(source).not.toContain('getImageStorageProvider');
		expect(source).not.toContain('downloadAwsImage');
		const authLookup = source.indexOf('authenticatedUser = await getAuthenticatedUser(req)');
		expect(authLookup).toBeGreaterThan(-1);
		expect(source.indexOf('const privateImage =')).toBeLessThan(authLookup);
		expect(authLookup).toBeLessThan(source.indexOf('const auth = await requireMember'));
		expect(source.indexOf('const auth = await requireMember')).toBeLessThan(
			source.indexOf('await downloadSupabaseImage'),
		);
		expect(source).not.toContain('createSignedUrl');
		expect(source).not.toContain('redirect(');
	});

	test('private signing keeps the upload response contract and immutable Supabase upload', async () => {
		const routeSource = await readSource('app/api/upload/sign/route.ts');
		const storageSource = await readSource('core/infra/supabase-storage.ts');

		expect(routeSource).toContain('getPrivateImageUrl');
		expect(storageSource).toContain('uploadHeaders');
		expect(storageSource).toContain('getBucket');
		expect(storageSource).toContain('upsert: false');
		expect(storageSource).toContain('hasExactPrivateImageBucketConfig');
	});
});

test.describe('upload sign s3 config contract', () => {
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
				serviceUnavailable: (message: string) => json({ error: message }, 503),
				unauthorized: (message: string, code?: string) =>
					json(code !== undefined ? { error: message, code } : { error: message }, 401),
			},
			'@/core/guards/api-auth': {
				requireMember: async () => ({
					ok: true,
					member: { memberId: 'member-1', name: 'Member' },
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
});

test.describe('private attachment draft recovery', () => {
	test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');

	const SHARE_CODE = FIXTURE_WG.shareCode;
	const FIRST_KEY = `manawg/${FIXTURE_WG.id}/expense/550e8400-e29b-41d4-a716-446655440001.png`;
	const SECOND_KEY = `manawg/${FIXTURE_WG.id}/expense/550e8400-e29b-41d4-a716-446655440002.png`;
	const PNG = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/70cAAAAASUVORK5CYII=',
		'base64',
	);

	test('restored expense draft keeps its image preview and can recover after last-reference revocation', async ({
		page,
	}) => {
		await setupMember(page);
		await page.addInitScript(() => {
			const key = '__e2e_private_attachment_csp_violations';
			if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, '[]');
			window.addEventListener('securitypolicyviolation', (event) => {
				const violations = JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
				violations.push(`${event.violatedDirective}: ${event.blockedURI}`);
				sessionStorage.setItem(key, JSON.stringify(violations));
			});
		});
		let uploadCount = 0;
		let oldImageUrl = '';
		let revoked = false;
		const imageReads: string[] = [];
		const storageUploadRequests: string[] = [];
		const submitted: Array<Record<string, unknown>> = [];

		await page.route(`**/api/wg/${SHARE_CODE}/expenses**`, async (route) => {
			const request = route.request();
			if (request.method() === 'GET')
				return route.fulfill({ json: { expenses: [], payments: [] } });
			if (request.method() !== 'POST') return route.fallback();

			const body = request.postDataJSON() as Record<string, unknown>;
			submitted.push(body);
			if (revoked && body.imageUrl === oldImageUrl) {
				return route.fulfill({
					status: 409,
					json: { error: 'image_removed', code: 'image_removed' },
				});
			}
			return route.fulfill({
				json: {
					expense: {
						...body,
						id: 'fixture-saved-expense',
						paidByMemberId: FIXTURE_WG.memberId,
						occurredAt: '2026-09-27T10:00:00.000Z',
						createdAt: '2026-09-27T10:00:00.000Z',
						updatedAt: '2026-09-27T10:00:00.000Z',
					},
					warning: null,
				},
			});
		});
		await page.route(`**/api/wg/${SHARE_CODE}/recurring-expenses**`, (route) =>
			route.fulfill({ json: { recurringExpenses: [] } }),
		);
		await page.route('**/api/upload/sign', async (route) => {
			const request = route.request();
			const key = uploadCount++ === 0 ? FIRST_KEY : SECOND_KEY;
			const publicUrl = new URL(
				`/api/upload/read?key=${encodeURIComponent(key)}`,
				new URL(request.url()).origin,
			).toString();
			const presignedUrl = new URL(
				`/__fixture_storage/upload-${uploadCount}`,
				new URL(request.url()).origin,
			).toString();
			if (!oldImageUrl) oldImageUrl = publicUrl;
			return route.fulfill({
				json: {
					presignedUrl,
					publicUrl,
					maxFileSize: 8 * 1024 * 1024,
					uploadHeaders: { 'Content-Type': 'image/png' },
				},
			});
		});
		await page.route('**/__fixture_storage/**', async (route) => {
			if (route.request().method() !== 'PUT') return route.fallback();
			storageUploadRequests.push(route.request().url());
			return route.fulfill({ status: 200 });
		});
		await page.route('**/api/upload/read?*', async (route) => {
			const key = new URL(route.request().url()).searchParams.get('key') ?? '';
			imageReads.push(key);
			if (revoked && key === FIRST_KEY) {
				return route.fulfill({ status: 404, headers: { 'Cache-Control': 'no-store' } });
			}
			return route.fulfill({
				status: 200,
				headers: { 'Cache-Control': 'no-store' },
				contentType: 'image/png',
				body: PNG,
			});
		});

		await navigateToFeature(page, `/wg/${SHARE_CODE}/ausgaben?new=1`);
		await dismissOnboarding(page);
		let form = page.getByRole('dialog');
		await form.getByLabel('Beschreibung').fill('Beleg-Entwurf');
		await form.getByLabel('Betrag').fill('12,35');
		await form.getByRole('button', { name: 'Beleg hinzufügen' }).click();
		await form.getByLabel('Bild auswählen').setInputFiles({
			name: 'beleg.png',
			mimeType: 'image/png',
			buffer: PNG,
		});
		await expect(form.getByRole('img', { name: 'Beleg hochgeladen' })).toBeVisible();
		const draftKey = buildDraftKey(SHARE_CODE, FIXTURE_WG.memberId, 'expense');
		await expect
			.poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey))
			.toContain(oldImageUrl);

		await page.reload({ waitUntil: 'domcontentloaded' });
		await dismissOnboarding(page);
		form = page.getByRole('dialog');
		await expect(form.getByRole('img', { name: 'Beleg hochgeladen' })).toBeVisible();
		await expect
			.poll(() => imageReads.filter((key) => key === FIRST_KEY).length)
			.toBeGreaterThan(1);

		revoked = true;
		await form.getByRole('button', { name: 'Ausgabe speichern' }).click();
		await expect(
			form.getByText(
				'Ausgabe konnte nicht gespeichert werden: Der Anhang wurde entfernt. Lade ihn erneut hoch.',
			),
		).toBeVisible();
		await expect
			.poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey))
			.toContain(oldImageUrl);

		await form.getByRole('button', { name: 'Beleg entfernen' }).click();
		await form.getByLabel('Bild auswählen').setInputFiles({
			name: 'beleg-neu.png',
			mimeType: 'image/png',
			buffer: PNG,
		});
		await expect(form.getByRole('img', { name: 'Beleg hochgeladen' })).toBeVisible();
		await form.getByRole('button', { name: 'Ausgabe speichern' }).click();
		await expect.poll(() => submitted.length).toBe(2);
		await expect(form).toBeHidden();
		expect(submitted[0]?.imageUrl).toBe(oldImageUrl);
		expect(submitted[1]?.imageUrl).not.toBe(oldImageUrl);
		expect(submitted[1]?.imageUrl).toContain(encodeURIComponent(SECOND_KEY));
		expect(storageUploadRequests).toHaveLength(2);
		const cspViolations = await page.evaluate(
			() =>
				JSON.parse(
					sessionStorage.getItem('__e2e_private_attachment_csp_violations') ?? '[]',
				) as string[],
		);
		expect(cspViolations).toEqual([]);
	});
});
