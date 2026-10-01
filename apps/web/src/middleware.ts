import { refreshSupabaseSession } from '@/core/auth/middleware';
import { isE2EDbDownMode } from '@/core/infra/e2e-db-down';
import {
	contentSecurityPolicy,
	crossOriginOpenerPolicy,
	isPayPalSdkEnabled,
} from '@/core/infra/security-headers';
import {
	checkRateLimit,
	clientIpKey,
	rateLimitFailMode,
	wgReadLimiter,
	wgShareCodeLookupLimiter,
	wgWriteLimiter,
} from '@/core/rate-limit';
import { type NextRequest, NextResponse } from 'next/server';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRateLimitedApiPath(path: string): boolean {
	return (
		path === '/api/account' ||
		path.startsWith('/api/auth/') ||
		path === '/api/wg' ||
		path.startsWith('/api/wg/') ||
		path.startsWith('/api/calendar/') ||
		path.startsWith('/api/upload/') ||
		path.startsWith('/api/cron/')
	);
}

export function isShareCodeLookup(path: string, method: string): boolean {
	return method === 'GET' && path !== '/api/wg/mine' && /^\/api\/wg\/[^/]+$/.test(path);
}

async function withPageSecurityHeaders(req: NextRequest): Promise<NextResponse> {
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const localFixtureHttp =
		isE2EDbDownMode() &&
		req.nextUrl.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname);
	const payPalSdkEnabled = isPayPalSdkEnabled(
		process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
		process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID,
	);
	const csp = contentSecurityPolicy(nonce, !localFixtureHttp, payPalSdkEnabled);
	const requestHeaders = new Headers(req.headers);
	requestHeaders.set('x-nonce', nonce);
	requestHeaders.set('Content-Security-Policy', csp);

	const res = NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
	res.headers.set('Content-Security-Policy', csp);
	const securedResponse = await refreshSupabaseSession(req, res);
	// COOP is a document policy. Keep it consistent on every app page so a
	// PayPal popup remains connected after an SPA navigation from / or /neu.
	securedResponse.headers.set(
		'Cross-Origin-Opener-Policy',
		crossOriginOpenerPolicy(payPalSdkEnabled),
	);
	return securedResponse;
}

function getClientIp(req: NextRequest): string {
	const key = clientIpKey(req);
	return key === 'anonymous' ? 'unknown' : key;
}

export function originAllowed(req: NextRequest): boolean {
	const origin = req.headers.get('origin');
	// Fail closed for cross-origin writes: a missing Origin header on a
	// mutating request means the caller is not a same-origin browser page.
	// Read requests (GET/HEAD/OPTIONS) without Origin are still allowed —
	// they are served from server-side fetches, CDN edge functions, and
	// legitimate non-browser clients that cannot set Origin.
	if (!origin) return req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
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
		return refreshSupabaseSession(req, NextResponse.next());
	}

	if (process.env.MIGRATION_READ_ONLY === 'true') {
		if (path === '/api/health') {
			return refreshSupabaseSession(req, NextResponse.next());
		}
		if (path.startsWith('/api/cron/')) {
			const retryAfter = '300';
			return NextResponse.json(
				{ error: 'migration_read_only', retryAfter: retryAfter },
				{ status: 503, headers: { 'Retry-After': retryAfter } },
			);
		}
		if (!READ_METHODS.has(req.method)) {
			const retryAfter = '300';
			return NextResponse.json(
				{ error: 'migration_read_only', retryAfter: retryAfter },
				{ status: 503, headers: { 'Retry-After': retryAfter } },
			);
		}
		return refreshSupabaseSession(req, NextResponse.next());
	}

	const ip = getClientIp(req);
	// Browsers send Origin on mutating fetches, but ordinary GET navigations and
	// server-to-server reads commonly omit it. Keep the CSRF guard strict for
	// writes without making cache-safe/read-only API access depend on a browser
	// header.
	if (!isRead && !originAllowed(req)) {
		return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
	}

	const isShareCodeLookupRequest = isShareCodeLookup(path, req.method);
	const limiter = isShareCodeLookupRequest
		? wgShareCodeLookupLimiter
		: isRead
			? wgReadLimiter
			: wgWriteLimiter;

	const result = await checkRateLimit(limiter, ip, rateLimitFailMode());
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

	return refreshSupabaseSession(req, NextResponse.next());
}

export const config = {
	// /api/wg (root) is matched explicitly because Next's :path* zero-or-more
	// matcher does not include the bare prefix without a trailing slash.
	// Missing it before meant POST /api/wg (create-WG) bypassed all limits.
	matcher: [
		'/((?!api|_next/static|_next/image|favicon.ico|manifest.json|.*\\..*).*)',
		'/api/account',
		'/api/auth/:path*',
		'/api/wg',
		'/api/wg/:path*',
		'/api/calendar/:path*',
		'/api/upload/:path*',
		'/api/cron/:path*',
	],
};
