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

const unreachableLimiter = {
	limit: async () => {
		throw new Error('upstash unreachable');
	},
};

test('getFailOpenStats counts fail-open events per cause', async () => {
	const capture: ObservabilityCapture = { captured: [] };
	const spy = spyConsoleError();
	const restore = pinEnv({});
	try {
		const rateLimit = loadRateLimit(capture);
		expect(rateLimit.getFailOpenStats()).toEqual({ total: 0, byCause: {} });

		const allowed = await rateLimit.checkRateLimit(null, 'member-1', 'open');
		expect(allowed).toEqual({ success: true, remaining: -1, reset: 0 });
		await rateLimit.checkRateLimit(null, 'member-2', 'open');

		const denied = await rateLimit.checkRateLimit(unreachableLimiter, 'member-3', 'closed');
		expect(denied.success).toBe(false);
		expect(denied.limiterUnavailable).toBe(true);

		expect(rateLimit.getFailOpenStats()).toEqual({
			total: 3,
			byCause: { 'upstash-not-configured': 2, 'limiter-call-failed': 1 },
		});

		rateLimit.resetOpenStateReporting();
		expect(rateLimit.getFailOpenStats()).toEqual({ total: 0, byCause: {} });

		await rateLimit.checkRateLimit(null, 'member-4', 'open');
		expect(rateLimit.getFailOpenStats()).toEqual({
			total: 1,
			byCause: { 'upstash-not-configured': 1 },
		});
	} finally {
		spy.restore();
		restore();
	}
});

test('the fail-open tally counts every production event while monitoring stays throttled', async () => {
	const capture: ObservabilityCapture = { captured: [] };
	const spy = spyConsoleError();
	const restore = pinEnv({ VERCEL_ENV: 'production' });
	try {
		const rateLimit = loadRateLimit(capture);
		await rateLimit.checkRateLimit(null, 'wg-1', 'closed');
		await rateLimit.checkRateLimit(null, 'wg-2', 'closed');
		await rateLimit.checkRateLimit(null, 'wg-3', 'closed');

		expect(rateLimit.getFailOpenStats()).toEqual({
			total: 3,
			byCause: { 'upstash-not-configured': 3 },
		});

		const productionAlerts = spy.calls.filter((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG);
		expect(productionAlerts).toHaveLength(3);

		expect(capture.captured).toHaveLength(1);
		expect((capture.captured[0][0] as Error).message).toBe(
			'rate-limit failing open: upstash-not-configured',
		);
		expect(capture.captured[0][1]).toEqual({ area: 'rate-limit', cause: 'upstash-not-configured' });
	} finally {
		spy.restore();
		restore();
	}
});

test('a throwing limiter is reported with its original error on every call', async () => {
	const capture: ObservabilityCapture = { captured: [] };
	const spy = spyConsoleError();
	const restore = pinEnv({ VERCEL_ENV: 'production' });
	try {
		const rateLimit = loadRateLimit(capture);
		await rateLimit.checkRateLimit(unreachableLimiter, 'wg-1', 'closed');
		await rateLimit.checkRateLimit(unreachableLimiter, 'wg-2', 'closed');

		expect(rateLimit.getFailOpenStats()).toEqual({
			total: 2,
			byCause: { 'limiter-call-failed': 2 },
		});
		const limiterFailures = spy.calls.filter(
			(args) => args[0] === '[rate-limit] limiter call failed, failing open:',
		);
		expect(limiterFailures).toHaveLength(2);
		expect((limiterFailures[0][1] as Error).message).toBe('upstash unreachable');
		expect(spy.calls.some((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG)).toBe(false);
		expect(capture.captured).toHaveLength(1);
		expect((capture.captured[0][0] as Error).message).toBe('upstash unreachable');
	} finally {
		spy.restore();
		restore();
	}
});

test('checkRateLimit accepts a minimal limit contract instead of a casted Ratelimit', async () => {
	const source = await readFile(RATE_LIMIT_PATH, 'utf8');

	expect(source).toContain("limiter: Pick<Ratelimit, 'limit'> | null");
	expect(source).not.toContain('as unknown as Ratelimit');
	expect(source).toContain("failMode: 'open' | 'closed' = rateLimitFailMode()");
});
