const SESSION_COOKIE = /(?:^|;\s*)sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?=/;

/**
 * Whether the browser holds a Supabase session cookie. Lets signed-out visitors skip
 * authenticated probes (e.g. /api/wg/mine) instead of logging a 401 console error.
 */
export function hasSessionCookie(): boolean {
	// Without Supabase configured (fixture builds) there is no cookie to look for.
	if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return true;
	return typeof document !== 'undefined' && SESSION_COOKIE.test(document.cookie);
}
