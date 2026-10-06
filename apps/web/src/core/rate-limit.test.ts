import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Ratelimit as SdkRatelimit } from '@upstash/ratelimit';

// The real SDK runs every limiter; only its algorithm and the Redis transport are stand-ins,
// so a test can script allow/deny decisions and prove that nothing reaches Redis.

type SdkOptions = ConstructorParameters<typeof SdkRatelimit>[0];
type Decision = { success: boolean; limit: number; remaining: number; reset: number };

const harness = {
	decisions: [] as Decision[],
	redisCalls: [] as { command: string; args: unknown[] }[],
	optionsSeen: [] as { analytics: boolean | undefined; prefix: string | undefined }[],
	sdkKeys: [] as string[],
	pending: [] as Promise<unknown>[],
	exceptions: [] as unknown[][],
};

const redis = new Proxy(
	{},
	{
		get:
			(_target, command) =>
			async (...args: unknown[]) => {
				harness.redisCalls.push({ command: String(command), args });
				return 1;
			},
	},
) as SdkOptions['redis'];

class TestRatelimit extends SdkRatelimit {
	constructor(options: SdkOptions) {
		harness.optionsSeen.push({ analytics: options.analytics, prefix: options.prefix });
		super({
			...options,
			redis,
			limiter: (() => ({
				limit: async () =>
					harness.decisions.shift() ?? {
						success: true,
						limit: 120,
						remaining: 119,
						reset: Date.now() + 60_000,
					},
			})) as unknown as SdkOptions['limiter'],
		});
		const limit = this.limit.bind(this);
		this.limit = async (...args: Parameters<typeof limit>) => {
			harness.sdkKeys.push(args[0]);
			const result = await limit(...args);
			if (result.pending) harness.pending.push(result.pending);
			return result;
		};
	}
}

class TestRedis {
	constructor() {
		Object.setPrototypeOf(this, redis);
	}
}

mock.module('@upstash/ratelimit', { namedExports: { Ratelimit: TestRatelimit } });
mock.module('@upstash/redis/cloudflare', { namedExports: { Redis: TestRedis } });
mock.module('@/core/infra/observability', {
	namedExports: {
		captureException: (...args: unknown[]) => {
			harness.exceptions.push(args);
		},
	},
});

// The module reads its Redis configuration once at load.
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.UPSTASH_REDIS_REST_URL = 'https://rate-limit.test';
env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
Reflect.deleteProperty(env, 'VERCEL_ENV');
const rateLimit = await import('./rate-limit');

test('built limiters preserve SDK allow/deny results without writing analytics', async () => {
	const now = Date.now();
	const decision = (success: boolean, remaining: number, reset: number): Decision => ({
		success,
		limit: 120,
		remaining,
		reset,
	});
	harness.decisions.push(decision(true, 119, now + 60_000), decision(false, 0, now + 45_000));
	const ip = '198.51.100.41';
	const allowed = await rateLimit.checkRateLimit(rateLimit.wgReadLimiter, ip, 'closed');
	const denied = await rateLimit.checkRateLimit(rateLimit.wgReadLimiter, ip, 'closed');
	await Promise.all(harness.pending);

	assert.deepEqual(allowed, { success: true, remaining: 119, reset: now + 60_000 });
	assert.deepEqual(denied, { success: false, remaining: 0, reset: now + 45_000 });
	assert.deepEqual(harness.sdkKeys, [ip, ip]);
	assert.ok(harness.optionsSeen.some(({ prefix }) => prefix === 'manawg:wg-read'));
	assert.deepEqual(harness.redisCalls, []);
	assert.ok(harness.optionsSeen.every(({ analytics }) => analytics === false));
});

test('SDK timeout results use the existing open and closed failure policies', async (t) => {
	env.NODE_ENV = 'production';
	env.VERCEL_ENV = 'production';
	t.after(() => {
		env.NODE_ENV = 'test';
		Reflect.deleteProperty(env, 'VERCEL_ENV');
	});
	const logs = t.mock.method(console, 'error', () => undefined);
	harness.exceptions = [];
	const sdkLimiter = new SdkRatelimit({
		redis,
		analytics: false,
		prefix: 'rate-limit-timeout-test',
		timeout: 1,
		limiter: (() => ({ limit: () => new Promise(() => {}) })) as unknown as SdkOptions['limiter'],
	});
	const timeoutResult = await sdkLimiter.limit('198.51.100.41');
	assert.equal(timeoutResult.success, true);
	assert.equal(timeoutResult.reason, 'timeout');

	rateLimit.resetOpenStateReporting();
	const limiter = { limit: async () => timeoutResult };
	const closed = await rateLimit.checkRateLimit(limiter, '198.51.100.41', 'closed');
	const open = await rateLimit.checkRateLimit(limiter, '198.51.100.41', 'open');

	assert.deepEqual(closed, {
		success: false,
		remaining: 0,
		reset: closed.reset,
		limiterUnavailable: true,
	});
	assert.ok(closed.reset > Date.now());
	assert.deepEqual(open, { success: true, remaining: -1, reset: 0 });
	assert.equal(logs.mock.callCount(), 2);
	assert.equal(harness.exceptions.length, 2);
});
