import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureException } from './infra/observability';

import {
	checkRateLimit,
	clientIpKey,
	getFailOpenStats,
	resetOpenStateReporting,
} from './rate-limit';

vi.mock('./infra/observability', () => ({ captureException: vi.fn() }));

const FAIL_OPEN_PRODUCTION_LOG =
	'[rate-limit] Upstash Redis not configured in production — failing open';

describe('checkRateLimit', () => {
	beforeEach(() => {
		resetOpenStateReporting();
		vi.mocked(captureException).mockClear();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('allows requests when limiter is missing outside production VERCEL_ENV', async () => {
		vi.stubEnv('NODE_ENV', 'test');
		vi.stubEnv('VERCEL_ENV', 'preview');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await checkRateLimit(null, '127.0.0.1');

		expect(result).toEqual({ success: true, remaining: -1, reset: 0 });
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('allows requests when limiter is missing and VERCEL_ENV is not production, even if NODE_ENV=production', async () => {
		// Misconfigured Redis on Vercel preview/dev must not break the app.
		// Only VERCEL_ENV=production triggers the fail-open alert path.
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('VERCEL_ENV', 'preview');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await checkRateLimit(null, '127.0.0.1');

		expect(result).toEqual({ success: true, remaining: -1, reset: 0 });
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('fails OPEN with a console.error alert when limiter is missing in production VERCEL_ENV', async () => {
		// A misconfigured rate limiter must NOT take down the API for real
		// users. We surface the misconfiguration via console.error (and
		// the platform log) but let traffic through.
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('VERCEL_ENV', 'production');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await checkRateLimit(null, '127.0.0.1');

		expect(result).toEqual({ success: true, remaining: -1, reset: 0 });
		expect(errorSpy).toHaveBeenCalledWith(FAIL_OPEN_PRODUCTION_LOG);
	});

	it('delegates to the configured limiter', async () => {
		const limiter = {
			limit: vi.fn().mockResolvedValue({
				success: false,
				remaining: 2,
				reset: 123456,
			}),
		};

		const result = await checkRateLimit(limiter as never, '203.0.113.7');

		expect(limiter.limit).toHaveBeenCalledWith('203.0.113.7');
		expect(result).toEqual({ success: false, remaining: 2, reset: 123456 });
	});

	it('fails OPEN when the limiter throws (e.g. Upstash quota exhausted)', async () => {
		// Upstash free tier can exhaust its monthly request quota mid-month.
		// When that happens, the limiter rejects with an UpstashError. Since
		// this runs inside Next.js Edge middleware, any uncaught throw turns
		// into MIDDLEWARE_INVOCATION_FAILED and 500s every /api/wg/* call.
		// Catch + fail-open so the app stays alive.
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const limiter = {
			limit: vi.fn().mockRejectedValue(new Error('UpstashError: max requests limit exceeded')),
		};

		const result = await checkRateLimit(limiter as never, '203.0.113.7');

		expect(result).toEqual({ success: true, remaining: -1, reset: 0 });
		expect(errorSpy).toHaveBeenCalled();
	});

	it('reports the unconfigured limiter so an open API is not invisible', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1');

		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ area: 'rate-limit', cause: 'upstash-not-configured' }),
		);
	});

	it('reports a throwing limiter with the original error', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('UpstashError: max requests limit exceeded');
		const limiter = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(limiter as never, '203.0.113.7');

		expect(captureException).toHaveBeenCalledWith(
			cause,
			expect.objectContaining({ cause: 'limiter-call-failed' }),
		);
	});

	it('throttles repeated reports so an outage does not emit one event per request', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1');
		await checkRateLimit(null, '127.0.0.2');
		await checkRateLimit(null, '127.0.0.3');

		expect(captureException).toHaveBeenCalledTimes(1);
	});

	it('never reports outside production', async () => {
		vi.stubEnv('VERCEL_ENV', 'preview');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1');

		expect(captureException).not.toHaveBeenCalled();
	});

	it('throttles a throwing limiter across repeated calls, not just the unconfigured path', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('UpstashError: max requests limit exceeded');
		const failing = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(failing as never, '203.0.113.7');
		await checkRateLimit(failing as never, '203.0.113.7');
		await checkRateLimit(failing as never, '203.0.113.7');

		expect(captureException).toHaveBeenCalledTimes(1);
	});

	it('always logs a throwing limiter even outside production', async () => {
		// A limiter that throws anywhere is a defect, so it is always logged
		// (unlike the unconfigured path, which is only newsworthy in prod).
		vi.stubEnv('VERCEL_ENV', 'preview');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('ECONNRESET');
		const failing = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(failing as never, '203.0.113.7');

		expect(errorSpy).toHaveBeenCalled();
		expect(captureException).not.toHaveBeenCalled();
	});

	it('keeps the unconfigured and throwing causes on independent throttles', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('boom');
		const failing = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(null, '127.0.0.1');
		await checkRateLimit(failing as never, '203.0.113.7');

		expect(captureException).toHaveBeenCalledTimes(2);
		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ cause: 'upstash-not-configured' }),
		);
		expect(captureException).toHaveBeenCalledWith(
			cause,
			expect.objectContaining({ cause: 'limiter-call-failed' }),
		);
	});

	it('re-emits the alert after the report interval so a sustained outage stays visible', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1');
		expect(captureException).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(6 * 60 * 1000);
		await checkRateLimit(null, '127.0.0.2');

		expect(captureException).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('counts every fail-open event in the observable tally, regardless of throttle', async () => {
		vi.stubEnv('VERCEL_ENV', 'preview');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('boom');
		const failing = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(null, '127.0.0.1');
		await checkRateLimit(failing as never, '203.0.113.7');
		await checkRateLimit(failing as never, '203.0.113.7');

		expect(getFailOpenStats()).toEqual({
			total: 3,
			byCause: { 'upstash-not-configured': 1, 'limiter-call-failed': 2 },
		});
	});

	it('clears the tally via the reporting test seam', async () => {
		vi.stubEnv('VERCEL_ENV', 'preview');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1');
		expect(getFailOpenStats().total).toBe(1);

		resetOpenStateReporting();
		expect(getFailOpenStats()).toEqual({ total: 0, byCause: {} });
	});

	it('preserves default-open behavior when failMode is omitted', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('boom');
		const failing = { limit: vi.fn().mockRejectedValue(cause) };

		const result = await checkRateLimit(failing as never, '203.0.113.7');

		expect(result).toEqual({ success: true, remaining: -1, reset: 0 });
		expect(errorSpy).toHaveBeenCalled();
	});

	it('fails CLOSED when limiter is missing', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const result = await checkRateLimit(null, '127.0.0.1', 'closed');

		expect(result).toEqual({
			success: false,
			remaining: 0,
			reset: expect.any(Number),
			limiterUnavailable: true,
		});
		expect(result.reset).toBeGreaterThan(Date.now());
	});

	it('fails CLOSED when the limiter throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('UpstashError: max requests limit exceeded');
		const limiter = { limit: vi.fn().mockRejectedValue(cause) };

		const result = await checkRateLimit(limiter as never, '203.0.113.7', 'closed');

		expect(result).toEqual({
			success: false,
			remaining: 0,
			reset: expect.any(Number),
			limiterUnavailable: true,
		});
		expect(result.reset).toBeGreaterThan(Date.now());
	});

	it('reports closed-mode configuration failures', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);

		await checkRateLimit(null, '127.0.0.1', 'closed');

		expect(captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ cause: 'upstash-not-configured' }),
		);
	});

	it('reports closed-mode limiter failures', async () => {
		vi.stubEnv('VERCEL_ENV', 'production');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const cause = new Error('UpstashError: max requests limit exceeded');
		const limiter = { limit: vi.fn().mockRejectedValue(cause) };

		await checkRateLimit(limiter as never, '203.0.113.7', 'closed');

		expect(captureException).toHaveBeenCalledWith(
			cause,
			expect.objectContaining({ cause: 'limiter-call-failed' }),
		);
	});
});

describe('clientIpKey', () => {
	it('uses the platform-appended X-Forwarded-For value instead of the spoofable first value', () => {
		const headers = new Headers({
			'x-forwarded-for': '198.51.100.66, 203.0.113.10',
		});

		expect(clientIpKey({ headers })).toBe('203.0.113.10');
	});
});
