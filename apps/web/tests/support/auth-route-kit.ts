// Fakes for the /api/auth/* route tests: the Supabase server client (its `auth` methods are set per
// test), the rate limiter and the env check. Call `installAuthRouteMocks()` before importing a route.
import { mock } from 'node:test';
import { NextRequest, type NextResponse } from 'next/server';

// biome-ignore lint/suspicious/noExplicitAny: test fakes receive whatever the route passes
type AuthMethod = (...args: any[]) => Promise<unknown>;

/** What a route handed to a Supabase auth method, for assertions. */
export type Captured = Record<string, unknown> & { options: Record<string, unknown> };

export const kit = {
	auth: {} as Record<string, AuthMethod>,
	envConfigured: true,
	limit: { success: true } as { success: boolean; limiterUnavailable?: boolean; reset?: number },
	forwardedIp: undefined as string | undefined,
	/** The response the Supabase client writes its cookies to; tests can set cookies on it. */
	cookieResponse: undefined as NextResponse | undefined,
};

export function installAuthRouteMocks(): void {
	kit.auth = {};
	kit.envConfigured = true;
	kit.limit = { success: true };
	kit.forwardedIp = undefined;
	mock.module('@/core/auth/server', {
		namedExports: {
			createSupabaseServerClient: (_request: unknown, response: NextResponse, ip?: string) => {
				kit.cookieResponse = response;
				kit.forwardedIp = ip;
				return { auth: kit.auth };
			},
		},
	});
	mock.module('@/core/auth/supabase-env', {
		namedExports: { hasSupabaseEnv: () => kit.envConfigured },
	});
	mock.module('@/core/rate-limit', {
		namedExports: {
			authAttemptLimiter: null,
			checkRateLimit: async () => ({ reset: Date.now() + 1000, remaining: 0, ...kit.limit }),
			clientIpKey: () => '203.0.113.9',
			rateLimitFailMode: () => 'closed',
		},
	});
	mock.module('@/core/infra/observability', {
		namedExports: { captureException: () => undefined, logApiError: () => undefined },
	});
}

type Handler = (request: NextRequest) => Promise<NextResponse>;

/** Call a route handler like the browser does: JSON body, same origin. */
export async function call(
	handler: Handler,
	path: string,
	body?: unknown,
	init: { method?: string; cookie?: string } = {},
) {
	const method = init.method ?? (body === undefined ? 'GET' : 'POST');
	const request = new NextRequest(`https://app.example.test${path}`, {
		method,
		headers: {
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			...(init.cookie ? { cookie: init.cookie } : {}),
		},
		...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
	});
	const response = await handler(request);
	return {
		status: response.status,
		json: (await response.json()) as Record<string, unknown>,
		response,
	};
}
