import type { NextRequest, NextResponse } from 'next/server';
import { isE2EDbDownMode } from './mode';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export interface FixtureRequest {
	/** The local fixture server speaks plain HTTP, so the CSP must not upgrade requests. */
	localHttp: boolean;
	/** The fixture answer for an API request, or `null` to let the route handle it. */
	apiResponse: () => Promise<NextResponse | null>;
}

/**
 * The single middleware seam of the database-free Playwright build. `null`
 * in every real build, so the middleware runs exactly as in production.
 * WG pages are served without a Supabase session in the fixture build.
 */
export function resolveFixtureRequest(req: NextRequest): FixtureRequest | null {
	if (!isE2EDbDownMode()) return null;
	return {
		localHttp: req.nextUrl.protocol === 'http:' && LOCAL_HOSTS.includes(req.nextUrl.hostname),
		// Loaded on demand: the fixture answers stay out of the production request path.
		apiResponse: async () => (await import('./api')).answerFixtureApiRequest(req),
	};
}
