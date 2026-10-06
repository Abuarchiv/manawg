// Rate limiting without Upstash: the pinned environment decides between failing open and closed,
// production alerts stay visible while monitoring captures are throttled, and limiter errors never
// leak their message.

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { inspect } from 'node:util';
import { spyConsoleError } from './support/values';

type RateLimitModule = typeof import('../src/core/rate-limit');

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

/** Monitoring captures of the module copy under test. */
let captured: unknown[][] = [];

mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: (...args: unknown[]) => {
			captured.push(args);
		},
	},
});

let loads = 0;

/**
 * Evaluates a fresh copy of the rate-limit module: it reads the Upstash environment once at load,
 * so each pinned environment needs its own copy.
 */
async function loadRateLimit(): Promise<RateLimitModule> {
	captured = [];
	loads += 1;
	return import(new URL(`../src/core/rate-limit.ts?load=${loads}`, import.meta.url).href);
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

describe('rate limit fail open env', () => {
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
				const rateLimit = await loadRateLimit();
				assert.equal(rateLimit.uploadSignLimiter, null);
				assert.equal(rateLimit.rateLimitFailMode(), failMode);

				const before = Date.now();
				const result = await rateLimit.checkRateLimit(rateLimit.uploadSignLimiter, 'member-1');

				assert.equal(result.success, success);
				assert.equal(result.limiterUnavailable ?? false, failMode === 'closed');
				if (failMode === 'closed') {
					assert.ok(result.reset >= before + 59_000);
					assert.equal(result.remaining, 0);
				} else {
					assert.equal(result.reset, 0);
					assert.equal(result.remaining, -1);
				}

				const alerts = spy.calls.filter((args) => args[0] === FAIL_CLOSED_PRODUCTION_LOG);
				assert.equal(alerts.length, productionAlert ? 1 : 0);
			} finally {
				spy.restore();
				restore();
			}
		});
	}

	test('the fail-open decision reads NODE_ENV and VERCEL_ENV at call time', async () => {
		const restoreProduction = pinEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production' });
		try {
			const rateLimit = await loadRateLimit();
			assert.equal(rateLimit.rateLimitFailMode(), 'closed');

			const restorePreview = pinEnv({ NODE_ENV: 'production', VERCEL_ENV: 'preview' });
			try {
				assert.equal(rateLimit.rateLimitFailMode(), 'open');
			} finally {
				restorePreview();
			}
		} finally {
			restoreProduction();
		}
	});

	test('Upstash URL validation rejects embedded credentials and URL parameters', async () => {
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
				await assert.rejects(loadRateLimit(), /UPSTASH_REDIS_REST_URL must be a valid https URL/);
			} finally {
				restore();
			}
		}
	});
});

describe('rate limit fail open stats', () => {
	test('production fail-open logs every event while the monitoring capture stays throttled', async () => {
		const spy = spyConsoleError();
		const restore = pinEnv({ VERCEL_ENV: 'production' });
		try {
			const rateLimit = await loadRateLimit();
			await rateLimit.checkRateLimit(null, 'wg-1', 'open');
			await rateLimit.checkRateLimit(null, 'wg-2', 'open');
			await rateLimit.checkRateLimit(null, 'wg-3', 'open');

			const productionAlerts = spy.calls.filter((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG);
			assert.equal(productionAlerts.length, 3);

			assert.equal(captured.length, 1);
			const throttledCapture = captured[0];
			assert.ok(throttledCapture?.[0] instanceof Error);
			assert.equal((throttledCapture?.[0] as Error).message, 'rate-limit failing open');
			assert.deepEqual(throttledCapture?.[1], {
				area: 'rate-limit',
				cause: 'upstash-not-configured',
			});
		} finally {
			spy.restore();
			restore();
		}
	});

	test('a closed limiter failure is reported without logging its thrown message', async () => {
		const spy = spyConsoleError();
		const restore = pinEnv({ VERCEL_ENV: 'production' });
		try {
			const rateLimit = await loadRateLimit();
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
			assert.equal(limiterFailures.length, 2);
			assert.equal(limiterFailures[0]?.length, 1);
			assert.equal(
				spy.calls.some((args) => args[0] === FAIL_OPEN_PRODUCTION_LOG),
				false,
			);
			assert.equal(captured.length, 1);
			assert.equal((captured[0]?.[0] as Error).message, 'rate-limit failing closed');
			assert.ok(!inspect([...spy.calls, ...captured]).includes('secret-test-sentinel'));

			await rateLimit.checkRateLimit(null, 'wg-3', 'closed');
			assert.equal(
				spy.calls.some((args) => args[0] === FAIL_CLOSED_PRODUCTION_LOG),
				true,
			);
		} finally {
			spy.restore();
			restore();
		}
	});
});
