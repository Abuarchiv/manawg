import {
	checkRateLimit,
	clientIpKey,
	wgReadLimiter,
	wgShareCodeLookupLimiter,
	wgWriteLimiter,
} from '@/core/rate-limit';
import { contentSecurityPolicy } from '@/shared/lib/security-headers';
import { type NextRequest, NextResponse } from 'next/server';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRateLimitedApiPath(path: string): boolean {
	return (
		path === '/api/wg' ||
		path.startsWith('/api/wg/') ||
		path.startsWith('/api/upload/') ||
		path.startsWith('/api/cron/')
	);
}

function withPageSecurityHeaders(req: NextRequest): NextResponse {
	const csp = contentSecurityPolicy();
	const requestHeaders = new Headers(req.headers);
	requestHeaders.set('Content-Security-Policy', csp);

	const res = NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
	res.headers.set('Content-Security-Policy', csp);
	return res;
}

function getClientIp(req: NextRequest): string {
	const key = clientIpKey(req);
	return key === 'anonymous' ? 'unknown' : key;
}

function originAllowed(req: NextRequest): boolean {
	const origin = req.headers.get('origin');
	if (!origin) return true;
	const host = req.headers.get('host');
	if (!host) return false;
	try {
		const originUrl = new URL(origin);
		return originUrl.host === host && originUrl.protocol === req.nextUrl.protocol;
	} catch {
		return false;
	}
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
	const isRead = READ_METHODS.has(req.method);
	const path = req.nextUrl.pathname;

	if (!path.startsWith('/api/')) {
		return withPageSecurityHeaders(req);
	}
	if (!isRateLimitedApiPath(path)) {
		return NextResponse.next();
	}

	if (process.env.MIGRATION_READ_ONLY === 'true') {
		if (path === '/api/health') {
			return NextResponse.next();
		}
		if (path.startsWith('/api/cron/')) {
			const retryAfter = '300';
			return NextResponse.json(
				{ error: 'migration_read_only', retryAfter: retryAfter },
				{ status: 503, headers: { 'Retry-After': retryAfter } },
			);
		}
		if (/^\/api\/wg\/[^/]+$/.test(path) && req.method === 'GET') {
			return NextResponse.next();
		}
		if (!READ_METHODS.has(req.method)) {
			const retryAfter = '300';
			return NextResponse.json(
				{ error: 'migration_read_only', retryAfter: retryAfter },
				{ status: 503, headers: { 'Retry-After': retryAfter } },
			);
		}
	}

	const ip = getClientIp(req);
	if (!isRead && !originAllowed(req)) {
		return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
	}

	const isShareCodeLookup = /^\/api\/wg\/[^/]+$/.test(path) && req.method === 'GET';
	const limiter = isShareCodeLookup
		? wgShareCodeLookupLimiter
		: isRead
			? wgReadLimiter
			: wgWriteLimiter;

	const failMode =
		isShareCodeLookup &&
		(process.env.NODE_ENV === 'production' ||
			process.env.NODE_ENV === 'test' ||
			process.env.VERCEL_ENV === 'production')
			? 'closed'
			: 'open';
	const result = await checkRateLimit(limiter, ip, failMode);
	if (!result.success) {
		if (result.limiterUnavailable) {
			const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
			return NextResponse.json(
				{ error: 'rate_limiter_unavailable', retryAfterMs: Math.max(0, result.reset - Date.now()) },
				{
					status: 503,
					headers: {
						'Retry-After': retryAfter.toString(),
					},
				},
			);
		}
		return NextResponse.json(
			{ error: 'rate_limited', retryAfterMs: Math.max(0, result.reset - Date.now()) },
			{
				status: 429,
				headers: {
					'Retry-After': Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)).toString(),
					'X-RateLimit-Remaining': String(result.remaining),
				},
			},
		);
	}

	return NextResponse.next();
}

export const config = {
	// /api/wg (root) is matched explicitly because Next's :path* zero-or-more
	// matcher does not include the bare prefix without a trailing slash.
	// Missing it before meant POST /api/wg (create-WG) bypassed all limits.
	matcher: [
		'/((?!api|_next/static|_next/image|favicon.ico|manifest.json|.*\\..*).*)',
		'/api/wg',
		'/api/wg/:path*',
		'/api/upload/:path*',
		'/api/cron/:path*',
	],
};
