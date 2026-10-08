import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Ratelimit as SdkRatelimit } from '@upstash/ratelimit';

// The module builds its limiters at import time from the Upstash settings, so the settings are
// in place before the import. The SDK's `Ratelimit` is subclassed so every limiter takes its
// decisions from the queue below and talks to a recording Redis instead of the network.

type Decision = { success: boolean; limit: number; remaining: number; reset: number };

const state = {
	decisions: [] as Decision[],
	redisCalls: [] as Array<{ command: string; args: unknown[] }>,
	optionsSeen: [] as Array<{ analytics: unknown; prefix: unknown }>,
	sdkKeys: [] as string[],
	pending: [] as Array<Promise<unknown>>,
	exceptions: [] as unknown[][],
};

const redis = new Proxy(
	{},
	{
		get:
			(_target, command) =>
			async (...args: unknown[]) => {
				state.redisCalls.push({ command: String(command), args });
				return 1;
			},
	},
);

type SdkOptions = ConstructorParameters<typeof SdkRatelimit>[0];

class TestRatelimit extends SdkRatelimit {
	constructor(options: SdkOptions) {
		state.optionsSeen.push({
			analytics: options.analytics,
			prefix: options.prefix,
		});
		super({
			...options,
			redis: redis as never,
			limiter: (() => ({
				limit: async () =>
					state.decisions.shift() ?? {
						success: true,
						limit: 120,
						remaining: 119,
						reset: Date.now() + 60_000,
					},
			})) as never,
		});
		const limit = this.limit.bind(this);
		this.limit = async (...args: Parameters<SdkRatelimit['limit']>) => {
			state.sdkKeys.push(args[0]);
			const result = await limit(...args);
			if (result.pending) state.pending.push(result.pending);
			return result;
		};
	}
}

class TestRedis {
	constructor() {
		Object.setPrototypeOf(this, redis);
	}
}

function withEnv(values: Record<string, string | undefined>): () => void {
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	for (const [name, value] of Object.entries(values)) {
		if (value === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = value;
	}
	return () => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) Reflect.deleteProperty(process.env, name);
			else process.env[name] = value;
		}
	};
}

mock.module('@upstash/ratelimit', { namedExports: { Ratelimit: TestRatelimit } });
mock.module('@upstash/redis/cloudflare', { namedExports: { Redis: TestRedis } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: (...args: unknown[]) => state.exceptions.push(args) },
});

const restoreImportEnv = withEnv({
	UPSTASH_REDIS_REST_URL: 'https://rate-limit.test',
	UPSTASH_REDIS_REST_TOKEN: 'fake-token',
});
const rateLimit = await import('./rate-limit');
restoreImportEnv();

test('built limiters preserve SDK allow/deny results without writing analytics', async () => {
	const now = Date.now();
	const decision = (success: boolean, remaining: number, reset: number) => ({
		success,
		limit: 120,
		remaining,
		reset,
	});
	state.decisions = [decision(true, 119, now + 60_000), decision(false, 0, now + 45_000)];
	state.sdkKeys = [];
	const ip = '198.51.100.41';
	const allowed = await rateLimit.checkRateLimit(rateLimit.wgReadLimiter, ip, 'closed');
	const denied = await rateLimit.checkRateLimit(rateLimit.wgReadLimiter, ip, 'closed');
	await Promise.all(state.pending);

	assert.deepEqual(allowed, { success: true, remaining: 119, reset: now + 60_000 });
	assert.deepEqual(denied, { success: false, remaining: 0, reset: now + 45_000 });
	assert.deepEqual(state.sdkKeys, [ip, ip]);
	assert.ok(state.optionsSeen.some(({ prefix }) => prefix === 'manawg:wg-read'));
	assert.deepEqual(state.redisCalls, []);
	assert.ok(state.optionsSeen.every(({ analytics }) => analytics === false));
});

test('SDK timeout results use the existing open and closed failure policies', async (t) => {
	const restoreEnv = withEnv({ NODE_ENV: 'production', VERCEL_ENV: 'production' });
	const consoleError = t.mock.method(console, 'error', () => {});
	state.exceptions = [];
	try {
		const sdkLimiter = new SdkRatelimit({
			redis: redis as never,
			analytics: false,
			prefix: 'rate-limit-timeout-test',
			timeout: 1,
			limiter: (() => ({ limit: () => new Promise(() => {}) })) as never,
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
		const logs = consoleError.mock.calls.filter(
			({ arguments: args }) => typeof args[0] === 'string' && args[0].startsWith('[rate-limit]'),
		);
		assert.equal(logs.length, 2);
		assert.equal(state.exceptions.length, 2);
	} finally {
		restoreEnv();
	}
});
