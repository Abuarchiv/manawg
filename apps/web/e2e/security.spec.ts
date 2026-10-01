// Security and HTTP contracts: CSRF/origin checks, security headers, membership guards (no 404 oracle),
// rate-limit fail-open behaviour, bounded body reads, idempotency replay and API client edge cases.
// Pure logic runs without a browser; these guard the trust boundary and must not regress silently.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import pathModule from 'node:path';
import path, { join } from 'node:path';
import { inspect } from 'node:util';
import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { deriveMemberToken, verifyMemberToken } from '../src/core/guards/member-token';
import {
	type ReplaySlotDependencies,
	type ReplaySlotResult,
	claimReplaySlot,
} from '../src/core/guards/replay-slot';
import { serverError } from '../src/core/http/api-errors';
import { readJsonBody } from '../src/core/http/read-json';
import { apiFetch } from '../src/core/infra/api-client';
import { isE2EDbDownMode } from '../src/core/infra/e2e-db-down';
import { captureException, logApiError } from '../src/core/infra/observability';
import { createPresignedUpload } from '../src/core/infra/s3';
import { contentSecurityPolicy } from '../src/core/infra/security-headers';
import { toCsv } from '../src/core/reads/export';
import { MAX_CSV_BYTES, readImportJsonBody } from '../src/features/expenses/import-body';
import { config, isShareCodeLookup, middleware, originAllowed } from '../src/middleware';
import { FIXTURE_WG, setupMember } from './_helpers';

test.describe('csrf origin', () => {
	const WRITE_URL = 'https://app.example.com/api/wg/ABCDEFGH/expenses';

	function request(headers: Record<string, string>, method = 'POST'): NextRequest {
		return new NextRequest(WRITE_URL, { method, headers });
	}

	test('allows same-origin writes and browser-less reads', () => {
		expect(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com' })),
		).toBe(true);
		expect(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com/' })),
		).toBe(true);
		expect(originAllowed(request({ host: 'app.example.com' }, 'GET'))).toBe(true);
		expect(originAllowed(request({ host: 'app.example.com' }, 'HEAD'))).toBe(true);
		expect(originAllowed(request({ host: 'app.example.com' }, 'OPTIONS'))).toBe(true);
	});

	test('fails closed for a write without an Origin header', () => {
		expect(originAllowed(request({ host: 'app.example.com' }))).toBe(false);
	});

	test('rejects cross-origin writes including takeover lookalikes', async () => {
		const rejected = [
			'https://evil.example.com',
			'https://app.example.com.evil.test',
			// A taken-over subdomain must not inherit the parent origin's trust.
			'https://takeover.app.example.com',
			// userinfo@host parsing: the real host is evil.test.
			'https://app.example.com@evil.test',
			// Port and protocol must match the request.
			'https://app.example.com:8443',
			'http://app.example.com',
			// Sandboxed iframes and non-http contexts send "null" or no usable URL.
			'null',
			'not-a-url',
		];

		for (const origin of rejected) {
			const req = request({ host: 'app.example.com', origin });
			expect(originAllowed(req), origin).toBe(false);
			expect((await middleware(req)).status, origin).toBe(403);
		}
	});

	test('rejects a write when the Host header is missing', () => {
		expect(originAllowed(request({ origin: 'https://app.example.com' }))).toBe(false);
	});

	test('treats an explicit default port as same-origin and still rejects others', () => {
		// Browsers normalize https://host:443 to https://host, so this IS same-origin.
		expect(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com:443' })),
		).toBe(true);
		expect(
			originAllowed(
				request({ host: 'app.example.com:3000', origin: 'https://app.example.com:3000' }),
			),
		).toBe(true);
		expect(
			originAllowed(request({ host: 'app.example.com', origin: 'https://app.example.com:3000' })),
		).toBe(false);
	});

	test('guards the password-recovery API like every other state-changing route', async () => {
		expect(config.matcher).toContain('/api/auth/:path*');
		const req = new NextRequest('https://app.example.com/api/auth/recovery', {
			method: 'DELETE',
			headers: { host: 'app.example.com', origin: 'https://evil.example.com' },
		});
		expect((await middleware(req)).status).toBe(403);
	});
});

test.describe('security headers', () => {
	test('CSP keeps upgrade-insecure-requests by default', () => {
		const nonce = 'security-headers-test-nonce';
		const policy = contentSecurityPolicy(nonce);

		expect(policy).toContain('upgrade-insecure-requests');
		expect(policy).toContain(`'nonce-${nonce}'`);
	});

	test('fixture CSP opt-out removes only upgrade-insecure-requests', () => {
		const nonce = 'security-headers-test-nonce';
		const defaultPolicy = contentSecurityPolicy(nonce);
		const fixturePolicy = contentSecurityPolicy(nonce, false);

		expect(fixturePolicy).toBe(defaultPolicy.replace(/; upgrade-insecure-requests$/, ''));
	});

	test('fixture guard allows Preview but rejects Production', () => {
		const keys = [
			'E2E_FIXTURE_MODE',
			'VERCEL_ENV',
			'NEXT_PUBLIC_DB_DOWN',
			'CI',
			'POSTGRES_URL',
			'DATABASE_URL',
		] as const;
		const saved = new Map(keys.map((key) => [key, process.env[key]]));

		try {
			process.env.E2E_FIXTURE_MODE = 'true';
			process.env.VERCEL_ENV = 'preview';
			process.env.NEXT_PUBLIC_DB_DOWN = 'true';
			process.env.CI = 'true';
			process.env.POSTGRES_URL = '';
			process.env.DATABASE_URL = '';
			expect(isE2EDbDownMode()).toBe(true);

			process.env.VERCEL_ENV = 'production';
			expect(isE2EDbDownMode()).toBe(false);
		} finally {
			for (const key of keys) {
				const value = saved.get(key);
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	test('local fixture HTTP response keeps the rest of the strict CSP', async ({ page }) => {
		test.skip(process.env.NEXT_PUBLIC_E2E_FIXTURE_MODE !== 'true', 'requires local fixture server');
		await setupMember(page);

		const response = await page.goto(`/wg/${FIXTURE_WG.shareCode}/putzen`, {
			waitUntil: 'domcontentloaded',
		});
		expect(response?.status()).toBe(200);

		const policy = response?.headers()['content-security-policy'] ?? '';
		expect(policy).not.toContain('upgrade-insecure-requests');
		expect(policy).toMatch(/script-src [^;]*'nonce-[^']+'/);
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("base-uri 'self'");
		expect(policy).toContain("form-action 'self'");
	});
});

test.describe('require wg member regression', () => {
	test('anonymous WG requests return auth_required before WG lookup', async ({ request }) => {
		for (const path of [
			'chat/messages',
			'dashboard',
			'expenses',
			'recurring-expenses',
			'chores',
			'absences',
		]) {
			const response = await request.get(`/api/wg/MTE8PZAT/${path}`, { timeout: 120_000 });

			expect(response.status(), path).toBe(401);
			expect(await response.json(), path).toEqual({
				error: 'auth_required',
				code: 'auth_required',
			});
		}
	});

	test('keeps account membership out of the share-code rate-limit bucket', () => {
		expect(isShareCodeLookup('/api/wg/mine', 'GET')).toBe(false);
		expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'GET')).toBe(true);
		expect(isShareCodeLookup('/api/wg/INVALID', 'GET')).toBe(true);
		expect(isShareCodeLookup('/api/wg/ABCDEFGH', 'POST')).toBe(false);
	});

	test('WG root verifies identity before looking up a live share code', () => {
		const source = readFileSync(join(__dirname, '../src/app/api/wg/[code]/route.ts'), 'utf8');
		const getHandler = source
			.split('export async function GET(')[1]
			?.split('export async function PATCH(')[0];
		if (!getHandler) throw new Error('GET handler not found');
		expect(getHandler.indexOf('if (isE2EDbDownMode())')).toBeLessThan(
			getHandler.indexOf('getAuthenticatedUser(req)'),
		);
		expect(getHandler.indexOf('getAuthenticatedUser(req)')).toBeLessThan(
			getHandler.indexOf('db.query.wgs.findFirst('),
		);
		expect(getHandler).toContain('requireMember(req, wg.id, user)');
	});
});

test.describe('member token', () => {
	test('member token verification rejects trailing non-hex data', () => {
		const previousSecret = process.env.MEMBER_SESSION_SECRET;
		process.env.MEMBER_SESSION_SECRET = 'auth-regression-secret';

		try {
			const token = deriveMemberToken(
				'989ac820-58b7-431f-9c65-28721264f333',
				'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			);
			expect(
				verifyMemberToken(
					'989ac820-58b7-431f-9c65-28721264f333',
					'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					token,
				),
			).toBe(true);
			expect(
				verifyMemberToken(
					'989ac820-58b7-431f-9c65-28721264f333',
					'7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
					`${token}g`,
				),
			).toBe(false);
		} finally {
			if (previousSecret === undefined)
				Reflect.deleteProperty(process.env, 'MEMBER_SESSION_SECRET');
			else process.env.MEMBER_SESSION_SECRET = previousSecret;
		}
	});

	test('normal server membership verification derives identity from auth and validates tokens', async () => {
		const source = await readFile(
			path.resolve(process.cwd(), 'src/core/guards/api-auth.ts'),
			'utf8',
		);
		expect(source).toContain('const verified = verifyMemberToken(');
		expect(source).toContain('member: { memberId: row.id, name: row.name, verified }');
	});
});

test.describe('api infra security contracts', () => {
	interface LoadedRoute {
		GET?: (req: Request) => Promise<Response>;
		POST?: (req: Request) => Promise<Response>;
	}

	function loadTs<T>(filePath: string, overrides: Record<string, unknown>): T {
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
			expect(output).not.toContain(providerPayload);
			expect(output).not.toContain('privatepayload');
			expect(output).not.toContain('query:');
			expect(output).toContain('wg-code');
			expect(output).toContain('[expenses GET]');
		} finally {
			console.error = original;
		}
	});

	test('health reports an unavailable limiter as 503 instead of rate limiting', async () => {
		const routePath = path.join(process.cwd(), 'src/app/api/health/route.ts');
		const nextServer = createRequire(routePath)('next/server') as typeof import('next/server');
		let databaseImports = 0;
		const route = loadTs<LoadedRoute>(routePath, {
			'@/core/infra/env': {
				checkEnv: () => ({ ok: true, missingRequired: [], degraded: [] }),
			},
			'@/core/rate-limit': {
				checkRateLimit: async () => ({
					success: false,
					remaining: 0,
					reset: Date.now() + 60_000,
					limiterUnavailable: true,
				}),
				clientIpKey: () => '127.0.0.1',
				healthLimiter: null,
			},
			'@/core/db': {
				get db() {
					databaseImports += 1;
					return { execute: async () => undefined };
				},
			},
			'next/server': nextServer,
		});

		const response = await route.GET?.(new Request('https://example.invalid/api/health'));
		expect(response?.status).toBe(503);
		expect(await response?.json()).toMatchObject({ error: 'rate_limiter_unavailable' });
		expect(response?.headers.get('retry-after')).not.toBeNull();
		expect(databaseImports).toBe(0);
	});

	test('upload-sign rejects an oversized unauthenticated JSON body before auth or database work', async () => {
		const routePath = path.join(process.cwd(), 'src/app/api/upload/sign/route.ts');
		const nextServer = createRequire(routePath)('next/server') as typeof import('next/server');
		const json = (body: unknown, status = 200) =>
			nextServer.NextResponse.json(body as Record<string, unknown>, { status });
		let authCalls = 0;
		let databaseCalls = 0;
		const route = loadTs<LoadedRoute>(routePath, {
			'@/core/auth/server': {
				getAuthenticatedUser: async () => {
					authCalls += 1;
					return null;
				},
			},
			'@/core/db': {
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
			'@/core/http/api-errors': {
				apiError: (message: string, status: number, code?: string) =>
					json(code ? { error: message, code } : { error: message }, status),
				badRequest: (message: string) => json({ error: message }, 400),
				notFound: (message: string) => json({ error: message }, 404),
				payloadTooLarge: (message = 'payload_too_large', code = 'payload_too_large') =>
					json({ error: message, code }, 413),
				tooMany: (message: string, code?: string) =>
					json(code ? { error: message, code } : { error: message }, 429),
				serverError: (message: string) => json({ error: message }, 500),
			},
			'@/core/guards/api-auth': { requireMember: async () => ({ ok: false }) },
			'@/core/http/read-json': { readJsonBody },
			'@/core/infra/private-image-policy': { PRIVATE_IMAGE_MIME_TYPES: ['image/png'] },
			'@/core/infra/s3': {
				S3ConfigurationError: class extends Error {},
				S3_MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
				createPresignedUpload: async () => ({}),
				isAllowedMimeType: () => true,
			},
			'@/core/infra/supabase-storage': {
				ImageStorageConfigurationError: class extends Error {},
				createSupabaseSignedUpload: async () => ({}),
				getImageStorageProvider: () => 'aws',
			},
			'@/core/rate-limit': {
				checkRateLimit: async () => ({ success: true }),
				uploadSignLimiter: null,
			},
			'@/core/validators/image-url': { getPrivateImageUrl: () => 'https://example.invalid/image' },
			'@/core/utils/share-code': {
				isValidShareCode: () => true,
				normalizeShareCode: (value: string) => value,
			},
			'next/server': nextServer,
		});

		const body = 'x'.repeat(16 * 1024 + 1);
		const request = new Request('https://example.invalid/api/upload/sign', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
		});
		const response = await route.POST?.(request);
		expect(response?.status).toBe(413);
		expect(await response?.json()).toEqual({
			error: 'payload_too_large',
			code: 'payload_too_large',
		});
		expect(response?.headers.get('cache-control')).toBe('no-store');
		expect(authCalls).toBe(0);
		expect(databaseCalls).toBe(0);
	});
});

test.describe('rate limit fail open env', () => {
	type RateLimitModule = typeof import('../src/core/rate-limit');

	const RATE_LIMIT_PATH = path.join(process.cwd(), 'src/core/rate-limit.ts');
	const FAIL_CLOSED_PRODUCTION_LOG =
		'[rate-limit] Upstash Redis not configured in production — failing closed';
	const ENV_KEYS = [
		'UPSTASH_REDIS_REST_URL',
		'UPSTASH_REDIS_REST_TOKEN',
		'VERCEL_ENV',
		'NODE_ENV',
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

	function pinEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): () => void {
		const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
		for (const key of ENV_KEYS) delete process.env[key];
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined) Reflect.set(process.env, key, value);
		}
		return () => {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else Reflect.set(process.env, key, value);
			}
		};
	}

	function loadRateLimit(): RateLimitModule {
		return loadTs<RateLimitModule>(RATE_LIMIT_PATH, {
			'@/core/infra/observability': { captureException: () => undefined },
		});
	}

	function spyConsoleError(): { calls: unknown[][]; restore: () => void } {
		const original = console.error;
		const calls: unknown[][] = [];
		console.error = (...args: unknown[]) => {
			calls.push(args);
		};
		return {
			calls,
			restore: () => {
				console.error = original;
			},
		};
	}

	interface EnvCase {
		env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
		failMode: 'open' | 'closed';
		success: boolean;
		productionAlert: boolean;
	}

	const ENV_CASES: EnvCase[] = [
		{
			env: { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
			failMode: 'open',
			success: true,
			productionAlert: false,
		},
		{
			env: { NODE_ENV: 'production', VERCEL_ENV: 'production' },
			failMode: 'closed',
			success: false,
			productionAlert: true,
		},
		{
			env: { NODE_ENV: 'production' },
			failMode: 'closed',
			success: false,
			productionAlert: false,
		},
		{
			env: { NODE_ENV: 'test', VERCEL_ENV: 'preview' },
			failMode: 'closed',
			success: false,
			productionAlert: false,
		},
		{
			env: { NODE_ENV: 'development', VERCEL_ENV: 'development' },
			failMode: 'open',
			success: true,
			productionAlert: false,
		},
	];

	for (const { env, failMode, success, productionAlert } of ENV_CASES) {
		const title = Object.entries(env)
			.map(([key, value]) => `${key}=${value}`)
			.join(' ');

		test(`fail mode is decided by pinned env (${title})`, async () => {
			const spy = spyConsoleError();
			const restore = pinEnv(env);
			try {
				const rateLimit = loadRateLimit();
				expect(rateLimit.uploadSignLimiter).toBeNull();
				expect(rateLimit.rateLimitFailMode()).toBe(failMode);

				const before = Date.now();
				const result = await rateLimit.checkRateLimit(rateLimit.uploadSignLimiter, 'member-1');

				expect(result.success).toBe(success);
				expect(result.limiterUnavailable ?? false).toBe(failMode === 'closed');
				if (failMode === 'closed') {
					expect(result.reset).toBeGreaterThanOrEqual(before + 59_000);
					expect(result.remaining).toBe(0);
				} else {
					expect(result.reset).toBe(0);
					expect(result.remaining).toBe(-1);
				}

				const alerts = spy.calls.filter((args) => args[0] === FAIL_CLOSED_PRODUCTION_LOG);
				expect(alerts).toHaveLength(productionAlert ? 1 : 0);
			} finally {
				spy.restore();
				restore();
			}
		});
	}

	test('the fail-open decision reads NODE_ENV and VERCEL_ENV at call time', async () => {
		const restoreProduction = pinEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production' });
		try {
			const rateLimit = loadRateLimit();
			expect(rateLimit.rateLimitFailMode()).toBe('closed');

			const restorePreview = pinEnv({ NODE_ENV: 'production', VERCEL_ENV: 'preview' });
			try {
				expect(rateLimit.rateLimitFailMode()).toBe('open');
			} finally {
				restorePreview();
			}
		} finally {
			restoreProduction();
		}
	});

	test('Upstash URL validation rejects embedded credentials and URL parameters', () => {
		for (const endpoint of [
			'https://user:password@redis.example.com',
			'https://redis.example.com/?token=secret-test-sentinel',
		]) {
			const restore = pinEnv({
				UPSTASH_REDIS_REST_URL: endpoint,
				UPSTASH_REDIS_REST_TOKEN: 'test-token',
				VERCEL_ENV: 'production',
			});
			try {
				expect(() => loadRateLimit()).toThrow('UPSTASH_REDIS_REST_URL must be a valid https URL');
			} finally {
				restore();
			}
		}
	});
});

test.describe('rate limit fail open stats', () => {
	type RateLimitModule = typeof import('../src/core/rate-limit');

	const RATE_LIMIT_PATH = path.join(process.cwd(), 'src/core/rate-limit.ts');
	const FAIL_OPEN_PRODUCTION_LOG =
		'[rate-limit] Upstash Redis not configured in production — failing open';
	const FAIL_CLOSED_PRODUCTION_LOG =
		'[rate-limit] Upstash Redis not configured in production — failing closed';
	const ENV_KEYS = [
		'UPSTASH_REDIS_REST_URL',
		'UPSTASH_REDIS_REST_TOKEN',
		'VERCEL_ENV',
		'NODE_ENV',
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

	function pinEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): () => void {
		const saved = ENV_KEYS.map((key) => [key, process.env[key]] as const);
		for (const key of ENV_KEYS) delete process.env[key];
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined) Reflect.set(process.env, key, value);
		}
		return () => {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else Reflect.set(process.env, key, value);
			}
		};
	}

	interface ObservabilityCapture {
		captured: unknown[][];
	}

	function loadRateLimit(capture: ObservabilityCapture): RateLimitModule {
		return loadTs<RateLimitModule>(RATE_LIMIT_PATH, {
			'@/core/infra/observability': {
				captureException: (...args: unknown[]) => {
					capture.captured.push(args);
				},
			},
		});
	}

	function spyConsoleError(): { calls: unknown[][]; restore: () => void } {
		const original = console.error;
		const calls: unknown[][] = [];
		console.error = (...args: unknown[]) => {
			calls.push(args);
		};
		return {
			calls,
			restore: () => {
				console.error = original;
			},
		};
	}

	test('production fail-open logs every event while the monitoring capture stays throttled', async () => {
		const capture: ObservabilityCapture = { captured: [] };
		const spy = spyConsoleError();
		const restore = pinEnv({ VERCEL_ENV: 'production' });
		try {
			const rateLimit = loadRateLimit(capture);
			await rateLimit.checkRateLimit(null, 'wg-1', 'open');
			await rateLimit.checkRateLimit(null, 'wg-2', 'open');
			await rateLimit.checkRateLimit(null, 'wg-3', 'open');

			const productionAlerts = spy.calls.filter((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG);
			expect(productionAlerts).toHaveLength(3);

			expect(capture.captured).toHaveLength(1);
			const throttledCapture = capture.captured[0];
			expect(throttledCapture?.[0]).toBeInstanceOf(Error);
			expect((throttledCapture?.[0] as Error).message).toBe('rate-limit failing open');
			expect(throttledCapture?.[1]).toEqual({
				area: 'rate-limit',
				cause: 'upstash-not-configured',
			});
		} finally {
			spy.restore();
			restore();
		}
	});

	test('a closed limiter failure is reported without logging its thrown message', async () => {
		const capture: ObservabilityCapture = { captured: [] };
		const spy = spyConsoleError();
		const restore = pinEnv({ VERCEL_ENV: 'production' });
		try {
			const rateLimit = loadRateLimit(capture);
			const sensitiveLimiter = {
				limit: async () => {
					throw new Error('secret-test-sentinel');
				},
			};
			await rateLimit.checkRateLimit(sensitiveLimiter, 'wg-1', 'closed');
			await rateLimit.checkRateLimit(sensitiveLimiter, 'wg-2', 'closed');

			const limiterFailures = spy.calls.filter(
				(args) => args[0] === '[rate-limit] limiter call failed, failing closed',
			);
			expect(limiterFailures).toHaveLength(2);
			expect(limiterFailures[0]).toHaveLength(1);
			expect(spy.calls.some((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG)).toBe(false);
			expect(capture.captured).toHaveLength(1);
			expect((capture.captured[0]?.[0] as Error).message).toBe('rate-limit failing closed');
			expect(inspect([...spy.calls, ...capture.captured])).not.toContain('secret-test-sentinel');

			await rateLimit.checkRateLimit(null, 'wg-3', 'closed');
			expect(spy.calls.some((args) => args[0] === FAIL_CLOSED_PRODUCTION_LOG)).toBe(true);
		} finally {
			spy.restore();
			restore();
		}
	});
});

test.describe('read json body', () => {
	test('bounded JSON reader rejects oversized bodies before parsing', async () => {
		const valid = await readJsonBody(
			new Request('https://example.invalid', {
				method: 'POST',
				body: JSON.stringify({ ok: true }),
			}),
			128,
		);
		const oversized = await readJsonBody(
			new Request('https://example.invalid', { method: 'POST', body: 'x'.repeat(129) }),
			128,
		);
		const malformed = await readJsonBody(
			new Request('https://example.invalid', { method: 'POST', body: '{' }),
			128,
		);

		expect(valid).toEqual({ ok: true, body: { ok: true } });
		expect(oversized).toEqual({ ok: false, reason: 'payload_too_large' });
		expect(malformed).toEqual({ ok: false, reason: 'invalid_json' });
	});

	test('import body rejects an oversized stream without a Content-Length header', async () => {
		let reads = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				reads += 1;
				controller.enqueue(new Uint8Array(64 * 1024));
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request('https://example.invalid', {
			method: 'POST',
			body,
			duplex: 'half',
		} as RequestInit & { duplex: 'half' });

		expect(request.headers.has('content-length')).toBe(false);
		expect(await readImportJsonBody(request)).toEqual({ ok: false, error: 'payload_too_large' });
		expect(cancelled).toBe(true);
		expect(reads).toBeLessThan(Math.ceil((MAX_CSV_BYTES + 16 * 1024) / (64 * 1024)) + 3);
	});
});

test.describe('idempotency regression', () => {
	type MutationResponse = { id: string };

	const body: MutationResponse = { id: 'winner-response' };
	const noWait = async () => undefined;

	async function mutateIfWinner(
		dependencies: ReplaySlotDependencies<MutationResponse>,
		mutationCount: { value: number },
	): Promise<ReplaySlotResult<MutationResponse>> {
		const slot = await claimReplaySlot('regression', 'same-key', dependencies);
		if (slot.won) mutationCount.value += 1;
		return slot;
	}

	test('idempotency never performs a second mutation for incomplete winners', async () => {
		for (const scenario of ['slow', 'lost-response'] as const) {
			await test.step(scenario, async () => {
				let claimed = false;
				let cached: MutationResponse | null = null;
				const mutationCount = { value: 0 };
				const dependencies: ReplaySlotDependencies<MutationResponse> = {
					claim: async () => {
						if (claimed) return false;
						claimed = true;
						return true;
					},
					read: async () => cached,
					sleep: async () => {
						if (scenario === 'slow') cached = body;
					},
				};

				await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toMatchObject({
					won: true,
				});

				if (scenario === 'slow') {
					await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toEqual({
						won: false,
						cached: body,
					});
				} else {
					await expect(mutateIfWinner(dependencies, mutationCount)).rejects.toMatchObject({
						message: 'idempotency_response_pending',
					});
				}

				expect(mutationCount.value).toBe(1);
			});
		}
	});

	test('idempotency claim and cache failures abort before mutation', async () => {
		for (const code of ['idempotency_claim_failed', 'idempotency_cache_read_failed'] as const) {
			const mutationCount = { value: 0 };
			const dependencies: ReplaySlotDependencies<MutationResponse> = {
				claim: async () => {
					if (code === 'idempotency_claim_failed') throw new Error(code);
					return false;
				},
				read: async () => {
					throw new Error(code);
				},
				sleep: noWait,
			};

			for (let attempt = 0; attempt < 2; attempt += 1) {
				await expect(mutateIfWinner(dependencies, mutationCount)).rejects.toMatchObject({
					message: code,
				});
			}
			expect(mutationCount.value).toBe(0);
		}
	});

	test('normal idempotency replay keeps one mutation and exposes retryable 503s', async () => {
		let claimed = false;
		let cached: MutationResponse | null = null;
		const mutationCount = { value: 0 };
		const dependencies: ReplaySlotDependencies<MutationResponse> = {
			claim: async () => {
				if (claimed) return false;
				claimed = true;
				return true;
			},
			read: async () => cached,
			sleep: noWait,
		};

		const first = await mutateIfWinner(dependencies, mutationCount);
		if (first.won) cached = body;
		await expect(mutateIfWinner(dependencies, mutationCount)).resolves.toEqual({
			won: false,
			cached: body,
		});
		expect(mutationCount.value).toBe(1);

		for (const code of [
			'idempotency_claim_failed',
			'idempotency_cache_read_failed',
			'idempotency_response_pending',
		] as const) {
			const response = serverError(new Error(code));
			expect(response.status).toBe(503);
			expect(response.headers.get('Retry-After')).toBe('1');
			expect(await response.json()).toEqual({
				error: 'service_unavailable',
				code: 'idempotency_retryable',
			});
		}
	});
});

test.describe('issue swarm routes', () => {
	async function readSource(relativePath: string): Promise<string> {
		return readFile(pathModule.join(process.cwd(), 'src', relativePath), 'utf8');
	}

	test('apiFetch treats non-JSON success responses as ambiguous', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response('not json', {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'text/plain' },
			});
		try {
			await expect(apiFetch('/api/test')).resolves.toEqual({
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('apiFetch treats malformed JSON success responses as ambiguous', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response('{', {
				status: 200,
				statusText: 'OK',
				headers: { 'content-type': 'application/json' },
			});
		try {
			await expect(apiFetch('/api/test')).resolves.toEqual({
				ok: false,
				status: 0,
				error: 'Unerwartete Serverantwort',
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test('CSV formula guards remain quoted after neutralization', () => {
		expect(toCsv([{ value: '=1+1' }], ['value'])).toBe('\uFEFFvalue\n"\'=1+1"');
	});

	test('CSV opens in German Excel: BOM, semicolons, decimal-comma amounts', () => {
		expect(
			toCsv(
				[
					{ title: 'Müll; "Bad"', amountCents: -1205 },
					{ title: 'x', amountCents: 5 },
				],
				['title', 'amountCents'],
			),
		).toBe('\uFEFFtitle;amount\n"Müll; ""Bad""";-12,05\nx;0,05');
	});

	test('presigned uploads reject path traversal keys before configuration lookup', async () => {
		await expect(createPresignedUpload('../outside.png', 'image/png', 1)).rejects.toThrow(
			'Invalid S3 key',
		);
	});

	test('serverError reports a null value safely and retains sanitized route labels', () => {
		const originalError = console.error;
		const calls: unknown[][] = [];
		console.error = (...args: unknown[]) => calls.push(args);
		try {
			const rawMessage = 'private provider response payload';
			const thrown = new Error(rawMessage);
			thrown.name = 'privateDbPassword123';
			const response = serverError(null);
			logApiError('[test route GET]', thrown);

			expect(response.status).toBe(500);
			expect(calls[0]).toEqual(['[error]', 'Error', {}]);
			expect(calls[1]).toEqual(['[test route GET]', 'Error']);
			expect(calls.flat().some((value) => value instanceof Error)).toBe(false);
			expect(JSON.stringify(calls)).not.toContain(rawMessage);
			expect(JSON.stringify(calls)).not.toContain('privateDbPassword123');
			expect(JSON.stringify(calls)).not.toContain('server_error');
		} finally {
			console.error = originalError;
		}
	});

	test('bulk shopping clear requires the WG admin role', async () => {
		const source = await readSource('app/api/wg/[code]/shopping/route.ts');

		expect(source).toContain('isWgAdmin(wgId, auth.member.memberId)');
	});

	test('imports preview authenticates before reading the capped body', async () => {
		const source = await readSource('app/api/wg/[code]/imports/preview/route.ts');

		expect(source.indexOf('const auth = await requireWgMember')).toBeLessThan(
			source.indexOf('const raw = await readImportJsonBody'),
		);
	});
});
