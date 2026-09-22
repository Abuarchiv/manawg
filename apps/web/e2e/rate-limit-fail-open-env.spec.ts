import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

type RateLimitModule = typeof import('../src/core/rate-limit');

const RATE_LIMIT_PATH = path.join(process.cwd(), 'src/core/rate-limit.ts');
const FAIL_OPEN_PRODUCTION_LOG =
	'[rate-limit] Upstash Redis not configured in production — failing open';
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
		if (value !== undefined) process.env[key] = value;
	}
	return () => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
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

			const alerts = spy.calls.filter((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG);
			expect(alerts).toHaveLength(productionAlert ? 1 : 0);
			expect(rateLimit.getFailOpenStats()).toEqual({
				total: 1,
				byCause: { 'upstash-not-configured': 1 },
			});
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

test('the production alert text is pinned so the test cannot drift with the environment', async () => {
	const source = await readFile(RATE_LIMIT_PATH, 'utf8');

	expect(source).toContain(FAIL_OPEN_PRODUCTION_LOG);
	expect(source).toContain("process.env.VERCEL_ENV === 'production'");
	expect(source).toContain("process.env.NODE_ENV === 'test'");
	expect(source).toContain('!process.env.VERCEL_ENV');
});
