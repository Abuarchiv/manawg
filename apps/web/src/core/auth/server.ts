import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { authCookieOptions } from './cookie-options';
import { applySessionHint, isAuthTokenCookie } from './session-hint-cookie';
import { getSupabaseEnv, hasSupabaseEnv } from './supabase-env';
import { supabaseFetch } from './supabase-fetch';
import { readVerifiedUser } from './verified-user';

const BEARER = /^Bearer ([\w.~+/=-]+)$/;
const WG_ROOT = /^\/api\/wg\/[^/]+$/;

function hasSessionCookie(request: NextRequest): boolean {
	return request.cookies.getAll().some(({ name }) => isAuthTokenCookie(name));
}

/**
 * Agents connected through the ManaWG MCP server send the user's Supabase access token as
 * `Authorization: Bearer` (OAuth through Supabase Auth, consent on /oauth/consent). It counts
 * for the WG API only: account, auth and upload routes stay with the person in the browser, and
 * an agent never deletes a whole WG.
 */
export function bearerTokenFor(request: NextRequest): string | null {
	const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
	if (!token) return null;
	const path = request.nextUrl.pathname;
	if (path !== '/api/wg' && !path.startsWith('/api/wg/')) return null;
	if (request.method === 'DELETE' && WG_ROOT.test(path)) return null;
	return token;
}

/**
 * `clientIp` is forwarded as `X-Forwarded-For`: Supabase Auth rate-limits sign-in, sign-up and
 * code verification per IP, and from the server every visitor would otherwise share ours.
 */
export function createSupabaseServerClient(
	request: NextRequest,
	response: NextResponse,
	clientIp?: string,
) {
	const { url, publishableKey } = getSupabaseEnv();
	const https = request.nextUrl.protocol === 'https:';

	return createServerClient(url, publishableKey, {
		cookieOptions: authCookieOptions(https),
		global: {
			fetch: supabaseFetch,
			...(clientIp ? { headers: { 'x-forwarded-for': clientIp } } : {}),
		},
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					response.cookies.set(name, value, options);
				}
				applySessionHint(response.cookies, cookiesToSet, https);
				for (const [name, value] of Object.entries(headers)) {
					response.headers.set(name, value);
				}
			},
		},
	});
}

export async function getAuthenticatedUser(request: NextRequest): Promise<Pick<User, 'id'> | null> {
	const token = bearerTokenFor(request);
	if (!token && !hasSessionCookie(request)) return null;
	const supabase = createSupabaseServerClient(request, NextResponse.next());
	return readVerifiedUser(supabase.auth, token ?? undefined);
}

/** Read the middleware-refreshed session in a server component without a module-level client. */
export async function getAuthenticatedUserFromCookies(): Promise<Pick<User, 'id'> | null> {
	if (!hasSupabaseEnv()) return null;
	const cookieStore = await cookies();
	const { url, publishableKey } = getSupabaseEnv();
	const supabase = createServerClient(url, publishableKey, {
		global: { fetch: supabaseFetch },
		cookies: {
			getAll: () => cookieStore.getAll(),
			setAll: () => undefined,
		},
	});
	return readVerifiedUser(supabase.auth);
}
