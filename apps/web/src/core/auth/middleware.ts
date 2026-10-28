import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import {
	authCookieOptions,
	SESSION_COOKIE_MAX_AGE_SECONDS,
	SESSION_HINT_COOKIE,
	sessionHintCookieOptions,
} from './cookie-options';
import { applySessionHint, isAuthTokenCookie } from './session-hint-cookie';
import { getSupabaseEnv, hasSupabaseEnv } from './supabase-env';
import { supabaseFetch } from './supabase-fetch';
import { readVerifiedUser } from './verified-user';

function signInRedirect(request: NextRequest, response: NextResponse): NextResponse {
	const url = request.nextUrl.clone();
	url.pathname = '/neu';
	url.search = '';
	url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
	const redirect = NextResponse.redirect(url);
	response.headers.forEach((value, name) => {
		const lowerName = name.toLowerCase();
		if (
			lowerName !== 'set-cookie' &&
			lowerName !== 'location' &&
			!lowerName.startsWith('x-middleware-')
		) {
			redirect.headers.set(name, value);
		}
	});
	for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
	redirect.headers.set('Cache-Control', 'private, no-store');
	return redirect;
}

/**
 * Keep `manawg_signed_in` in step with the session cookies the browser sent. A session that
 * predates the hint (cookies written by the old browser client, readable by scripts) is
 * migrated once: the same values are written again, now HttpOnly, next to the hint.
 */
function syncSessionHint(request: NextRequest, response: NextResponse, signedIn: boolean): void {
	const https = request.nextUrl.protocol === 'https:';
	const tokens = request.cookies.getAll().filter((c) => isAuthTokenCookie(c.name) && c.value);
	const hasHint = request.cookies.get(SESSION_HINT_COOKIE)?.value === '1';
	if (tokens.length === 0) {
		if (hasHint) {
			response.cookies.set(SESSION_HINT_COOKIE, '', {
				...sessionHintCookieOptions(https),
				maxAge: 0,
			});
		}
		return;
	}
	if (!signedIn || hasHint || response.cookies.has(SESSION_HINT_COOKIE)) return;
	response.cookies.set(SESSION_HINT_COOKIE, '1', sessionHintCookieOptions(https));
	for (const { name, value } of tokens) {
		if (response.cookies.has(name)) continue;
		response.cookies.set(name, value, {
			...authCookieOptions(https),
			maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
		});
	}
}

/**
 * Refresh sessions and require social authentication before serving WG pages.
 * `requireWgSignIn: false` is only passed for builds that serve WG pages
 * without a Supabase session at all.
 */
export async function refreshSupabaseSession(
	request: NextRequest,
	response: NextResponse,
	{ requireWgSignIn = true }: { requireWgSignIn?: boolean } = {},
): Promise<NextResponse> {
	const requiresSignIn = request.nextUrl.pathname.startsWith('/wg/') && requireWgSignIn;
	if (!hasSupabaseEnv()) return requiresSignIn ? signInRedirect(request, response) : response;

	const { url, publishableKey } = getSupabaseEnv();
	const https = request.nextUrl.protocol === 'https:';
	let refreshedResponse = response;
	const supabase = createServerClient(url, publishableKey, {
		cookieOptions: authCookieOptions(https),
		global: { fetch: supabaseFetch },
		cookies: {
			getAll: () => request.cookies.getAll(),
			setAll: (cookiesToSet, headers = {}) => {
				for (const { name, value } of cookiesToSet) {
					request.cookies.set(name, value);
				}
				const requestHeaders = new Headers(request.headers);
				refreshedResponse.headers.forEach((value, name) => {
					const lowerName = name.toLowerCase();
					if (!lowerName.startsWith('x-middleware-request-')) return;
					const forwardedName = lowerName.slice('x-middleware-request-'.length);
					if (forwardedName !== 'cookie') requestHeaders.set(forwardedName, value);
				});
				requestHeaders.set('cookie', request.cookies.toString());

				const nextResponse = NextResponse.next({ request: { headers: requestHeaders } });
				refreshedResponse.headers.forEach((value, name) => {
					const lowerName = name.toLowerCase();
					if (lowerName !== 'set-cookie' && !lowerName.startsWith('x-middleware-')) {
						nextResponse.headers.set(name, value);
					}
				});
				for (const cookie of refreshedResponse.cookies.getAll()) nextResponse.cookies.set(cookie);
				for (const { name, value, options } of cookiesToSet) {
					nextResponse.cookies.set(name, value, options);
				}
				applySessionHint(nextResponse.cookies, cookiesToSet, https);
				for (const [name, value] of Object.entries(headers)) {
					nextResponse.headers.set(name, value);
				}
				refreshedResponse = nextResponse;
			},
		},
	});

	try {
		const signedIn = (await readVerifiedUser(supabase.auth)) !== null;
		syncSessionHint(request, refreshedResponse, signedIn);
		if (requiresSignIn && !signedIn) return signInRedirect(request, refreshedResponse);
	} catch {
		// A transient Auth failure is not "signed out": serve the page and let
		// app/wg/[code]/layout.tsx fail closed. That layout is then the only
		// barrier for /wg/*, which scripts/check-wg-auth-invariant.mjs keeps
		// true by rejecting route handlers and server actions under app/wg/**.
		// Public entry pages remain available when Auth cannot be reached.
		return refreshedResponse;
	}
	return refreshedResponse;
}
