/**
 * Attributes of the Supabase session cookies. The browser client reads them, so they cannot
 * be HttpOnly; everything else is pinned: `Secure` whenever the page is served over HTTPS,
 * `SameSite=Lax` so cross-site POSTs never carry the session, one site-wide path.
 */
export function authCookieOptions(https: boolean): {
	path: '/';
	sameSite: 'lax';
	secure: boolean;
} {
	return { path: '/', sameSite: 'lax', secure: https };
}
