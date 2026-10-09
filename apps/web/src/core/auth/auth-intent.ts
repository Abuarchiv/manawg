import { getInitialJoinCode } from '@/core/infra/join-flow';
import { safeNextPath } from './next-path';

/** The pages that start an account flow; neither may be a post-login `next` target. */
export const SIGN_IN_PATH = '/neu';
export const SIGN_UP_PATH = '/registrieren';

/** Sign-in, registration and the `/auth/*` utility routes are never a place to return to after login. */
export function isAuthPagePath(path: string): boolean {
	const { pathname } = new URL(path, 'https://manawg.invalid');
	return pathname === SIGN_IN_PATH || pathname === SIGN_UP_PATH || pathname.startsWith('/auth/');
}

/**
 * Reduces a query string to the intent the start flow understands: a valid share code,
 * the create action, and a safe return path. Anything else is dropped, so the result
 * can be appended to links and to the e-mail confirmation target.
 */
export function authIntentQuery(search: string): string {
	const source = new URLSearchParams(search);
	const params = new URLSearchParams();
	const code = getInitialJoinCode(search);
	if (code) params.set('code', code);
	else if (source.get('action') === 'create') params.set('action', 'create');
	const next = safeNextPath(source.get('next'));
	if (next !== '/' && !isAuthPagePath(next)) params.set('next', next);
	return params.toString();
}

/** Link to a sign-in or registration page that keeps the visitor's validated intent. */
export function authPageHref(page: typeof SIGN_IN_PATH | typeof SIGN_UP_PATH, search: string) {
	const query = authIntentQuery(search);
	return query ? `${page}?${query}` : page;
}
