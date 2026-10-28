import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, mock, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import { applyEnv } from './support/env.ts';

// Rate-limit fail mode (open or closed) is decided from the environment, and the production
// alerts are logged per event while the monitoring capture stays throttled. The module reads
// its Upstash settings at load time, so every scenario imports a fresh instance.

type RateLimitModule = typeof import('../src/core/rate-limit.ts');

const RATE_LIMIT_URL = pathToFileURL(
	path.join(import.meta.dirname, '..', 'src/core/rate-limit.ts'),
).href;
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

let captured: unknown[][] = [];
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: (...args: unknown[]) => {
			captured.push(args);
		},
	},
});

let loads = 0;
function loadRateLimit(): Promise<RateLimitModule> {
	loads += 1;
	return import(`${RATE_LIMIT_URL}?load=${loads}`);
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

function pinEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): () => void {
	return applyEnv({ ...Object.fromEntries(ENV_KEYS.map((key) => [key, undefined])), ...values });
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

	test('a standalone production server without Upstash counts in memory', async () => {
		const restore = pinEnv({ NODE_ENV: 'production' });
		try {
			const rateLimit = await loadRateLimit();
			assert.notEqual(rateLimit.uploadSignLimiter, null);
			const results = [];
			for (let i = 0; i < 11; i += 1) {
				results.push(await rateLimit.checkRateLimit(rateLimit.uploadSignLimiter, 'member-1'));
			}
			assert.equal(results.filter((result) => result.success).length, 10);
			assert.equal(results.at(-1)?.limiterUnavailable, undefined);
		} finally {
			restore();
		}
	});

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
				await assert.rejects(loadRateLimit(), {
					message: 'UPSTASH_REDIS_REST_URL must be a valid https URL',
				});
			} finally {
				restore();
			}
		}
	});
});

describe('rate limit fail open stats', () => {
	test('production fail-open logs every event while the monitoring capture stays throttled', async () => {
		captured = [];
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
			assert.equal((throttledCapture[0] as Error).message, 'rate-limit failing open');
			assert.deepEqual(throttledCapture[1], {
				area: 'rate-limit',
				cause: 'upstash-not-configured',
			});
		} finally {
			spy.restore();
			restore();
		}
	});

	test('a closed limiter failure is reported without logging its thrown message', async () => {
		captured = [];
		const spy = spyConsoleError();
		const restore = pinEnv({ VERCEL_ENV: 'production' });
		try {
			const rateLimit = await loadRateLimit();
			const sensitiveLimiter = {
				limit: async () => {
					throw new Error('secret-test-sentinel');
				},
			};
			await rateLimit.checkRateLimit(sensitiveLimiter as never, 'wg-1', 'closed');
			await rateLimit.checkRateLimit(sensitiveLimiter as never, 'wg-2', 'closed');

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

describe('rate limit subjects', () => {
	function ipRequest(forwarded: string): { headers: Headers } {
		return { headers: new Headers({ 'x-forwarded-for': forwarded }) };
	}

	test('IPv6 clients share one bucket per /64, IPv4 stays exact', async () => {
		const restore = pinEnv({ NODE_ENV: 'test' });
		try {
			const { clientIpKey } = await loadRateLimit();
			const key = clientIpKey(ipRequest('2001:db8:1:2:aaaa:bbbb:cccc:dddd'));
			assert.equal(key, '2001:db8:1:2::/64');
			assert.equal(clientIpKey(ipRequest('2001:0db8:0001:0002::1')), key);
			assert.equal(clientIpKey(ipRequest('[2001:DB8:1:2:1:2:3:4]')), key);
			assert.equal(clientIpKey(ipRequest('2001:db8:1:3::1')), '2001:db8:1:3::/64');
			assert.equal(clientIpKey(ipRequest('::1')), '0:0:0:0::/64');
			assert.equal(clientIpKey(ipRequest('::ffff:203.0.113.7')), '203.0.113.7');
			assert.equal(clientIpKey(ipRequest('203.0.113.7')), '203.0.113.7');
			assert.equal(clientIpKey({ headers: new Headers() }), 'anonymous');
		} finally {
			restore();
		}
	});

	test('two sessions behind the same IP are counted separately', async () => {
		const restore = pinEnv({ NODE_ENV: 'test' });
		try {
			const { sessionRateLimitKey } = await loadRateLimit();
			const cookies = (...entries: [string, string][]) => ({
				cookies: { getAll: () => entries.map(([name, value]) => ({ name, value })) },
			});
			const alice = await sessionRateLimitKey(cookies(['sb-proj-auth-token', 'alice-secret']));
			const bob = await sessionRateLimitKey(cookies(['sb-proj-auth-token', 'bob-secret']));
			assert.ok(alice && bob);
			assert.notEqual(alice, bob);
			assert.equal(
				alice,
				await sessionRateLimitKey(cookies(['sb-proj-auth-token', 'alice-secret'])),
			);
			// Chunked cookies hash together regardless of header order; the value is never exposed.
			const chunked = await sessionRateLimitKey(
				cookies(['sb-proj-auth-token.1', 'b'], ['sb-proj-auth-token.0', 'a']),
			);
			assert.equal(
				chunked,
				await sessionRateLimitKey(
					cookies(['sb-proj-auth-token.0', 'a'], ['sb-proj-auth-token.1', 'b']),
				),
			);
			assert.ok(!alice.includes('alice-secret'));
			assert.equal(await sessionRateLimitKey(cookies(['theme', 'dark'])), null);
		} finally {
			restore();
		}
	});
});
