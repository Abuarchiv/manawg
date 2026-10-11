import { SESSION_HINT_COOKIE } from './cookie-options';

/**
 * Whether the server has marked this browser as signed in (`manawg_signed_in`, kept in step
 * with the HttpOnly session cookies). Lets signed-out visitors skip authenticated probes
 * (e.g. /api/wg/mine) instead of logging a 401 console error.
 */
export function hasSessionCookie(): boolean {
	// Without Supabase configured (fixture builds) there is no cookie to look for.
	if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return true;
	return (
		typeof document !== 'undefined' &&
		new RegExp(`(?:^|;\\s*)${SESSION_HINT_COOKIE}=1(?:;|$)`).test(document.cookie)
	);
}
