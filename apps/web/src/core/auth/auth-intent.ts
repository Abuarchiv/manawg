import { safeNextPath } from './next-path';

/** The pages that start an account flow; neither may be a post-login `next` target. */
const SIGN_IN_PATH = '/login';
const SIGN_UP_PATH = '/signup';

/** Sign-in, registration and the `/auth/*` utility routes are never a place to return to after login. */
export function isAuthPagePath(path: string): boolean {
	const { pathname } = new URL(path, 'https://manawg.invalid');
	return pathname === SIGN_IN_PATH || pathname === SIGN_UP_PATH || pathname.startsWith('/auth/');
}

/**
 * Reduces a query string to the intent the start flow understands: the create action and
 * a safe return path (an invitation travels as `next=/invite/<token>`). Anything else
 * is dropped, so the result can be appended to links and to the e-mail confirmation target.
 */
export function authIntentQuery(search: string): string {
	const source = new URLSearchParams(search);
	const params = new URLSearchParams();
	if (source.get('action') === 'create') params.set('action', 'create');
	const next = safeNextPath(source.get('next'));
	if (next !== '/' && !isAuthPagePath(next)) params.set('next', next);
	return params.toString();
}

/** Link to a sign-in or registration page that keeps the visitor's validated intent. */
export function authPageHref(page: typeof SIGN_IN_PATH | typeof SIGN_UP_PATH, search: string) {
	const query = authIntentQuery(search);
	return query ? `${page}?${query}` : page;
}

/**
 * The page behind a sign-in page's own `next`: `/login?next=/invite/x` becomes `/invite/x`. Other
 * targets (including a sign-in page that carries the create action) stay as they are. A failed
 * mail or provider callback lands on `/login` with this as `next`, so the start flow can still
 * lead the visitor on to the invitation once they have signed in there.
 */
export function unwrapSignInNext(path: string): string {
	if (!isAuthPagePath(path)) return path;
	const { pathname, searchParams } = new URL(path, 'https://manawg.invalid');
	if (pathname !== SIGN_IN_PATH && pathname !== SIGN_UP_PATH) return path;
	if (searchParams.get('action') === 'create') return path;
	const inner = safeNextPath(searchParams.get('next'));
	return inner !== '/' && !isAuthPagePath(inner) ? inner : path;
}
