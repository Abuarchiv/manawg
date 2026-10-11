import type { NextResponse } from 'next/server';
import { SESSION_HINT_COOKIE, sessionHintCookieOptions } from './cookie-options';

const AUTH_TOKEN_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

type CookieWrite = { name: string; value: string };

/** A Supabase session cookie, including its `.0`/`.1` chunks but not the PKCE verifier. */
export function isAuthTokenCookie(name: string): boolean {
	return AUTH_TOKEN_COOKIE.test(name);
}

/**
 * Mirror the session cookies Supabase is about to write into the `manawg_signed_in` hint: set it
 * (and extend its lifetime) when a session is stored, clear it when the session cookies are
 * removed. Writes that do not touch the session cookies leave the hint alone.
 */
export function applySessionHint(
	jar: NextResponse['cookies'],
	cookiesToSet: readonly CookieWrite[],
	https: boolean,
): void {
	const tokens = cookiesToSet.filter(({ name }) => isAuthTokenCookie(name));
	if (tokens.length === 0) return;
	const options = sessionHintCookieOptions(https);
	if (tokens.some(({ value }) => value !== '')) jar.set(SESSION_HINT_COOKIE, '1', options);
	else jar.set(SESSION_HINT_COOKIE, '', { ...options, maxAge: 0 });
}
