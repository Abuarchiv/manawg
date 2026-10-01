const SESSION_COOKIE = /(?:^|;\s*)sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?=/;

/**
 * Whether the browser holds a Supabase session cookie. Lets signed-out visitors skip
 * authenticated probes (e.g. /api/wg/mine) instead of logging a 401 console error.
 */
export function hasSessionCookie(): boolean {
	return typeof document !== 'undefined' && SESSION_COOKIE.test(document.cookie);
}
