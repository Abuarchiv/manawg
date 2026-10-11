/**
 * Attributes of the Supabase session cookies. Only the server reads and writes them, so they are
 * `HttpOnly`: a script (XSS) cannot steal the session, and Safari does not apply its 7-day cap
 * to script-written cookies. Everything else is pinned too: `Secure` whenever the page is
 * served over HTTPS, `SameSite=Lax` so cross-site POSTs never carry the session, one
 * site-wide path.
 */
export function authCookieOptions(https: boolean): {
	path: '/';
	sameSite: 'lax';
	secure: boolean;
	httpOnly: true;
} {
	return { path: '/', sameSite: 'lax', secure: https, httpOnly: true };
}

/** Lifetime of the Supabase session cookies (`@supabase/ssr` default, 400 days). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Non-sensitive companion cookie: readable by scripts, tells the client that a session exists. */
export const SESSION_HINT_COOKIE = 'manawg_signed_in';

export function sessionHintCookieOptions(https: boolean): {
	path: '/';
	sameSite: 'lax';
	secure: boolean;
	httpOnly: false;
	maxAge: number;
} {
	return {
		path: '/',
		sameSite: 'lax',
		secure: https,
		httpOnly: false,
		maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
	};
}
