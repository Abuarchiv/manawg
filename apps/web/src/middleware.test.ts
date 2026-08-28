import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimitMock = vi.hoisted(() => ({
	checkRateLimit: vi.fn(),
	wgReadLimiter: { name: 'read' },
	wgShareCodeLookupLimiter: { name: 'share-code' },
	wgWriteLimiter: { name: 'write' },
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
	return {
		...actual,
		checkRateLimit: (...args: unknown[]) => rateLimitMock.checkRateLimit(...args),
		clientIpKey: (req: { headers: Headers }) =>
			req.headers
				.get('x-forwarded-for')
				?.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
				.at(-1) ?? 'anonymous',
		wgReadLimiter: rateLimitMock.wgReadLimiter,
		wgShareCodeLookupLimiter: rateLimitMock.wgShareCodeLookupLimiter,
		wgWriteLimiter: rateLimitMock.wgWriteLimiter,
	};
});

describe('middleware security controls', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rateLimitMock.checkRateLimit.mockResolvedValue({
			success: true,
			remaining: 10,
			reset: Date.now() + 60_000,
		});
	});

	it('includes cron routes in the middleware matcher', async () => {
		const { config } = await import('./middleware');

		expect(config.matcher).toContain('/api/cron/:path*');
	});

	it('adds a static-render compatible CSP to app pages without rate limiting them', async () => {
		const { middleware } = await import('./middleware');

		const res = await middleware(new NextRequest('https://mana.test/wg/MTE8PZAT'));
		const csp = res.headers.get('Content-Security-Policy');

		expect(csp).toContain("script-src 'self' 'unsafe-inline'");
		expect(csp).toContain("style-src 'self' 'unsafe-inline'");
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('allows the OCR import flow to load Tesseract assets from jsDelivr', async () => {
		const { middleware } = await import('./middleware');

		const res = await middleware(new NextRequest('https://mana.test/wg/MTE8PZAT/import'));
		const csp = res.headers.get('Content-Security-Policy');

		expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net");
		expect(csp).toContain("connect-src 'self' https://cdn.jsdelivr.net https://*.s3.amazonaws.com");
		expect(csp).toContain("worker-src 'self' blob: https://cdn.jsdelivr.net");
	});

	it('leaves unrelated API routes outside the WG/upload/cron limiters', async () => {
		const { middleware } = await import('./middleware');

		const res = await middleware(new NextRequest('https://mana.test/api/health'));

		expect(res.status).toBe(200);
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('uses the platform-appended X-Forwarded-For value for the rate-limit key', async () => {
		const { middleware } = await import('./middleware');

		await middleware(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				headers: {
					host: 'mana.test',
					origin: 'https://mana.test',
					'x-forwarded-for': '198.51.100.66, 203.0.113.10',
				},
			}),
		);

		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgWriteLimiter,
			'203.0.113.10',
			'open',
		);
	});

	it('rejects HTTP origins on HTTPS requests even when the host matches', async () => {
		const { middleware } = await import('./middleware');

		const res = await middleware(
			new NextRequest('https://mana.test/api/wg', {
				method: 'POST',
				headers: {
					host: 'mana.test',
					origin: 'http://mana.test',
				},
			}),
		);

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ error: 'cross_origin_blocked' });
		expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
	});

	it('uses closed mode for share-code lookups', async () => {
		const { middleware } = await import('./middleware');

		await middleware(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', {
				method: 'GET',
				headers: {
					host: 'mana.test',
					origin: 'https://mana.test',
				},
			}),
		);

		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgShareCodeLookupLimiter,
			'unknown',
			'closed',
		);
	});

	it('returns 503 when the share-code lookup limiter is unavailable', async () => {
		const { middleware } = await import('./middleware');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: Date.now() + 60_000,
			limiterUnavailable: true,
		});

		const res = await middleware(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', {
				method: 'GET',
				headers: {
					host: 'mana.test',
					origin: 'https://mana.test',
				},
			}),
		);

		expect(res.status).toBe(503);
		await expect(res.json()).resolves.toEqual({
			error: 'rate_limiter_unavailable',
			retryAfterMs: expect.any(Number),
		});
		expect(res.headers.get('Retry-After')).toBe('60');
	});

	it('returns 429 for normal rate-limit hits on share-code lookups', async () => {
		const { middleware } = await import('./middleware');
		rateLimitMock.checkRateLimit.mockResolvedValueOnce({
			success: false,
			remaining: 0,
			reset: Date.now() + 30_000,
		});

		const res = await middleware(
			new NextRequest('https://mana.test/api/wg/MTE8PZAT', {
				method: 'GET',
				headers: {
					host: 'mana.test',
					origin: 'https://mana.test',
				},
			}),
		);

		expect(res.status).toBe(429);
		expect(rateLimitMock.checkRateLimit).toHaveBeenCalledWith(
			rateLimitMock.wgShareCodeLookupLimiter,
			'unknown',
			'closed',
		);
	});

	describe('MIGRATION_READ_ONLY', () => {
		beforeEach(() => {
			process.env.MIGRATION_READ_ONLY = 'true';
			vi.clearAllMocks();
			rateLimitMock.checkRateLimit.mockResolvedValue({
				success: true,
				remaining: 10,
				reset: Date.now() + 60_000,
			});
		});

		afterEach(() => {
			process.env.MIGRATION_READ_ONLY = undefined;
		});

		it('blocks POST /api/wg', async () => {
			const { middleware } = await import('./middleware');

			const res = await middleware(new NextRequest('https://mana.test/api/wg', { method: 'POST' }));

			expect(res.status).toBe(503);
			await expect(res.json()).resolves.toEqual({
				error: 'migration_read_only',
				retryAfter: '300',
			});
			expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
		});

		it('blocks PATCH and DELETE on WG paths', async () => {
			const { middleware } = await import('./middleware');

			const patchRes = await middleware(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'PATCH' }),
			);
			expect(patchRes.status).toBe(503);

			const deleteRes = await middleware(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'DELETE' }),
			);
			expect(deleteRes.status).toBe(503);
		});

		it('blocks GET on cron paths', async () => {
			const { middleware } = await import('./middleware');

			const res = await middleware(
				new NextRequest('https://mana.test/api/cron/recurring-advance', {
					method: 'GET',
				}),
			);

			expect(res.status).toBe(503);
			await expect(res.json()).resolves.toEqual({
				error: 'migration_read_only',
				retryAfter: '300',
			});
		});

		it('allows GET /api/wg/<code>', async () => {
			const { middleware } = await import('./middleware');

			const res = await middleware(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'GET' }),
			);

			expect(res.status).toBe(200);
			expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
		});

		it('allows GET /api/health outside the guard', async () => {
			const { middleware } = await import('./middleware');

			const res = await middleware(new NextRequest('https://mana.test/api/health'));

			expect(res.status).toBe(200);
			expect(rateLimitMock.checkRateLimit).not.toHaveBeenCalled();
		});

		it('without MIGRATION_READ_ONLY leaves existing tests green', async () => {
			process.env.MIGRATION_READ_ONLY = undefined;
			const { middleware } = await import('./middleware');

			const _res = await middleware(
				new NextRequest('https://mana.test/api/wg/MTE8PZAT', { method: 'GET' }),
			);

			expect(rateLimitMock.checkRateLimit).toHaveBeenCalled();
		});
	});
});
